import base64
import io
import os
import time

import fitz  # PyMuPDF
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from groq import APIConnectionError, APIError, AuthenticationError, BadRequestError, Groq, RateLimitError
from pypdf import PdfReader

load_dotenv()

# ---------------------------------------------------------------------------
# Settings (all can be overridden with environment variables)
# ---------------------------------------------------------------------------
MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")                 # writes the notes
VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")      # reads scanned pages

MAX_FILE_MB = 50                                      # matches "Maximum file size: 50 MB" in the UI
MIN_TEXT_CHARS = 200                                  # below this, the PDF is treated as scanned
MAX_TEXT_CHARS = int(os.getenv("MAX_TEXT_CHARS", "30000"))   # text sent to the notes model
MAX_OCR_PAGES = int(os.getenv("MAX_OCR_PAGES", "15"))        # scanned pages to read
PAGES_PER_REQUEST = int(os.getenv("PAGES_PER_REQUEST", "1"))   # images per vision request

DEFAULT_PROMPT = """You are a study assistant. Turn the document into clear, structured study notes.

Use these sections with markdown headings:
1. What the text is trying to say
2. Key concepts and definitions
3. Important points to remember
4. Quick revision notes

Use simple language, bullet points where helpful, and bold the key terms.
Finish with concise revision notes. Avoid unnecessary repetition."""

# ---------------------------------------------------------------------------
# App + CORS
# ---------------------------------------------------------------------------
app = FastAPI(title="StudyMate API")

allowed_origins = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "https://ai-study-assistant-one-zeta.vercel.app,http://localhost:5173",
    ).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://ai-study-assistant.*\.vercel\.app",  # Vercel preview URLs
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def health():
    return {"status": "ok", "service": "StudyMate API"}


# ---------------------------------------------------------------------------
# Groq helpers
# ---------------------------------------------------------------------------
def get_client() -> Groq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="Server is missing GROQ_API_KEY. Add it to the backend environment variables.",
        )
    return Groq(api_key=api_key)


def ask_groq(model: str, messages: list, max_tokens: int = 4000) -> str:
    client = get_client()
    completion = None

    for attempt in range(3):
        try:
            completion = client.chat.completions.create(
                model=model,
                messages=messages,
                max_completion_tokens=max_tokens,
            )
            break
        except RateLimitError as e:
            if attempt < 2:
                # Wait for the time Groq asks for, then try again
                try:
                    wait = float(e.response.headers.get("retry-after", 15))
                except Exception:
                    wait = 15
                time.sleep(min(wait, 30) + 1)
                continue
            raise HTTPException(
                status_code=429,
                detail=f"Groq free-tier limit reached: {getattr(e, 'message', 'rate limited')}",
            )
        except AuthenticationError:
            raise HTTPException(status_code=500, detail="The Groq API key is invalid or has been revoked.")
        except BadRequestError as e:
            raise HTTPException(
                status_code=422,
                detail=f"The AI couldn't process this request: {getattr(e, 'message', 'bad request')}",
            )
        except APIConnectionError:
            raise HTTPException(status_code=502, detail="Couldn't reach the AI service. Please try again.")
        except APIError as e:
            raise HTTPException(
                status_code=502,
                detail=f"The AI service returned an error: {getattr(e, 'message', 'unknown error')}",
            )

    text = (completion.choices[0].message.content or "").strip()
    if not text:
        raise HTTPException(status_code=502, detail="The AI returned an empty response.")
    return text


def make_notes(prompt: str, document_text: str) -> str:
    messages = [
        {"role": "system", "content": "You are a helpful, accurate study assistant."},
        {
            "role": "user",
            "content": f"{prompt}\n\n--- DOCUMENT TEXT ---\n{document_text[:MAX_TEXT_CHARS]}",
        },
    ]
    return ask_groq(MODEL, messages, max_tokens=4000)


# ---------------------------------------------------------------------------
# PDF helpers
# ---------------------------------------------------------------------------
def extract_text(data: bytes) -> str:
    """Return the text layer of a PDF, or an empty string if there is none."""
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                return ""
        return "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    except Exception:
        return ""


def ocr_with_vision(data: bytes):
    """Render scanned pages to images and have the vision model transcribe them.

    Returns (text, pages_read, total_pages).
    """
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        raise HTTPException(status_code=422, detail="Couldn't open this PDF. The file may be damaged.")

    if doc.is_encrypted:
        raise HTTPException(status_code=422, detail="This PDF is password-protected.")

    total = len(doc)
    pages_to_read = min(total, MAX_OCR_PAGES)
    chunks = []

    for start in range(0, pages_to_read, PAGES_PER_REQUEST):
        content = [
            {
                "type": "text",
                "text": (
                    "Transcribe all readable text from these pages, in order. "
                    "Keep headings, lists, tables and formulas. Output only the transcription."
                ),
            }
        ]
        for i in range(start, min(start + PAGES_PER_REQUEST, pages_to_read)):
            pix = doc[i].get_pixmap(matrix=fitz.Matrix(1.4, 1.4))
            b64 = base64.b64encode(pix.tobytes("jpeg")).decode("utf-8")
            content.append(
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
            )

        chunks.append(ask_groq(VISION_MODEL, [{"role": "user", "content": content}], max_tokens=3000))

    return "\n\n".join(chunks).strip(), pages_to_read, total


# ---------------------------------------------------------------------------
# Main endpoint
# ---------------------------------------------------------------------------
@app.post("/api/analyze")
async def analyze(request: Request):
    form = await request.form()

    # Find the uploaded file regardless of the form field name the frontend uses.
    upload = None
    for _, value in form.multi_items():
        if hasattr(value, "filename") and hasattr(value, "read") and value.filename:
            upload = value
            break

    if upload is None:
        raise HTTPException(status_code=400, detail="No PDF file was uploaded.")

    # Optional instruction text sent by the frontend (any of these field names).
    prompt = DEFAULT_PROMPT
    for key in ("prompt", "instruction", "instructions", "question", "query"):
        value = form.get(key)
        if isinstance(value, str) and value.strip():
            prompt = value.strip()
            break

    data = await upload.read()

    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(data) > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File is larger than {MAX_FILE_MB} MB.")
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="That file doesn't look like a valid PDF.")

    # 1) Normal PDFs: use the text layer.
    text = await run_in_threadpool(extract_text, data)
    if len(text) >= MIN_TEXT_CHARS:
        answer = await run_in_threadpool(make_notes, prompt, text)
        return {"answer": answer, "source": "text"}

    # 2) Scanned / image-only PDFs: read the pages with the vision model first.
    ocr_text, pages_read, total_pages = await run_in_threadpool(ocr_with_vision, data)

    if len(ocr_text) < MIN_TEXT_CHARS:
        raise HTTPException(
            status_code=422,
            detail="Couldn't read any text from this PDF. The scan may be too blurry or empty.",
        )

    answer = await run_in_threadpool(make_notes, prompt, ocr_text)

    if total_pages > pages_read:
        answer += (
            f"\n\n---\n*Note: this is a scanned PDF, so only the first {pages_read} "
            f"of {total_pages} pages were read.*"
        )

    return {"answer": answer, "source": "ocr", "pages_read": pages_read, "total_pages": total_pages}