import os
import traceback
from pathlib import Path
from typing import Optional

import pymupdf
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq

# ---------- Config ----------
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
MAX_CHARS = 30000  # limit text sent to the model

app = FastAPI(title="Study Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Routes ----------
@app.get("/")
def home():
    return {"message": "Study Assistant API is running"}


@app.post("/api/analyze")
async def process_pdf(
    file: Optional[UploadFile] = File(None),
    pdf: Optional[UploadFile] = File(None),
    document: Optional[UploadFile] = File(None),
):
    uploaded_file = file or pdf or document

    if not uploaded_file:
        raise HTTPException(status_code=422, detail="No PDF file received.")

    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY is not set. Add it to backend/.env and restart the server.",
        )

    try:
        pdf_bytes = await uploaded_file.read()

        # Extract text from the PDF
        extracted_text = ""
        try:
            doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
            for page in doc:
                txt = page.get_text("text", sort=True)
                if txt and txt.strip():
                    extracted_text += txt + "\n"
            doc.close()
        except Exception as pdf_err:
            print(f"PDF extraction error: {pdf_err}")

        if not extracted_text.strip():
            raise HTTPException(
                status_code=422,
                detail="Couldn't extract text from this PDF. It may be a scanned document.",
            )

        extracted_text = extracted_text[:MAX_CHARS]

        prompt = (
            "Analyze the following study material and provide detailed AI study notes. "
            "The text was extracted from a PDF and may contain OCR errors, broken words, "
            "or odd line breaks; infer the intended meaning and do not mention the errors. "
            "Use markdown with these numbered headings:\n"
            "1. What the text is trying to say\n"
            "2. Key concepts and definitions\n"
            "3. Important points to remember\n"
            "4. Short summary\n"
            "5. Five practice questions\n\n"
            f"Study material:\n{extracted_text}"
        )

        client = Groq(api_key=GROQ_API_KEY)
        completion = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
        )

        response_text = completion.choices[0].message.content

        return {
            "filename": uploaded_file.filename,
            "analysis": response_text,
            "summary": response_text,
            "result": response_text,
            "text": response_text,
        }

    except HTTPException:
        raise
    except Exception as e:
        print("--- SERVER ERROR TRACEBACK ---")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))