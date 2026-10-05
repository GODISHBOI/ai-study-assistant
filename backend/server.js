import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { PDFParse } from "pdf-parse";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

/* =========================================================
   STUDYMATE AI BACKEND
   ========================================================= */

const app = express();

const PORT = process.env.PORT || 5000;

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY;

/* =========================================================
   GEMINI SETUP
========================================================= */

let genAI = null;

if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(
    GEMINI_API_KEY
  );

  console.log("Gemini AI: ENABLED");
} else {
  console.log(
    "Gemini AI: DISABLED - GEMINI_API_KEY missing"
  );
}

/*
   IMPORTANT:
   Do NOT use gemini-2.0-flash.
   It is unavailable according to the
   error shown in your terminal.

   We try the current PDF-capable model
   first and then fall back.
*/

const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
];

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(
  express.json({
    limit: "20mb",
  })
);

/* =========================================================
   MULTER / PDF UPLOAD
========================================================= */

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 50 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    const isPDF =
      file.mimetype === "application/pdf" ||
      file.originalname
        .toLowerCase()
        .endsWith(".pdf");

    if (isPDF) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only PDF files are allowed."
        )
      );
    }
  },
});

/* =========================================================
   IN-MEMORY DOCUMENT STORAGE
========================================================= */

const documents = new Map();

let nextDocumentId = 1;

/* =========================================================
   BASIC ROUTES
========================================================= */

app.get("/", (req, res) => {
  res.json({
    success: true,
    message:
      "StudyMate AI backend is running.",
    server:
      `http://localhost:${PORT}`,
    gemini:
      !!GEMINI_API_KEY,
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    gemini:
      !!GEMINI_API_KEY,
  });
});

/* =========================================================
   PDF TEXT EXTRACTION
========================================================= */

async function extractPDFText(buffer) {
  let parser = null;

  try {
    parser = new PDFParse({
      data: buffer,
    });

    const result =
      await parser.getText();

    const text =
      result?.text || "";

    try {
      await parser.destroy();
    } catch (e) {}

    parser = null;

    return text;
  } catch (error) {
    console.error(
      "PDF text extraction failed:",
      error.message
    );

    if (parser) {
      try {
        await parser.destroy();
      } catch (e) {}
    }

    return "";
  }
}

/* =========================================================
   CLEAN TEXT
========================================================= */

function cleanText(text) {
  if (!text) {
    return "";
  }

  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* =========================================================
   CHUNKING
========================================================= */

function createChunks(
  text,
  chunkSize = 5000,
  overlap = 500
) {
  if (!text || !text.trim()) {
    return [];
  }

  const chunks = [];

  let start = 0;

  while (start < text.length) {
    let end = Math.min(
      start + chunkSize,
      text.length
    );

    if (end < text.length) {
      const paragraphEnd =
        text.lastIndexOf(
          "\n\n",
          end
        );

      const sentenceEnd =
        text.lastIndexOf(
          ". ",
          end
        );

      if (
        paragraphEnd >
        start + chunkSize * 0.6
      ) {
        end = paragraphEnd;
      } else if (
        sentenceEnd >
        start + chunkSize * 0.6
      ) {
        end =
          sentenceEnd + 1;
      }
    }

    const chunk =
      text.slice(start, end).trim();

    if (chunk.length > 30) {
      chunks.push({
        id:
          chunks.length + 1,
        text: chunk,
      });
    }

    if (end >= text.length) {
      break;
    }

    start = Math.max(
      end - overlap,
      start + 1
    );
  }

  return chunks;
}

/* =========================================================
   KEYWORDS
========================================================= */

function extractKeywords(query) {
  if (!query) {
    return [];
  }

  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "what",
    "why",
    "how",
    "when",
    "where",
    "which",
    "who",
    "explain",
    "please",
    "tell",
    "give",
    "me",
    "about",
    "for",
    "and",
    "or",
    "of",
    "to",
    "in",
    "on",
    "with",
    "from",
    "this",
    "that",
    "these",
    "those",
    "can",
    "could",
    "would",
    "should",
  ]);

  return query
    .toLowerCase()
    .replace(
      /[^a-z0-9\s]/g,
      " "
    )
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 2 &&
        !stopWords.has(word)
    );
}

/* =========================================================
   RETRIEVE RELEVANT CHUNKS
========================================================= */

function retrieveRelevantChunks(
  chunks,
  query,
  maxChunks = 8
) {
  if (!chunks.length) {
    return [];
  }

  if (!query) {
    return chunks.slice(
      0,
      maxChunks
    );
  }

  const keywords =
    extractKeywords(query);

  if (!keywords.length) {
    return chunks.slice(
      0,
      maxChunks
    );
  }

  const scored =
    chunks.map((chunk) => {
      const lower =
        chunk.text.toLowerCase();

      let score = 0;

      for (const keyword of keywords) {
        if (
          lower.includes(keyword)
        ) {
          score += 3;
        }

        score +=
          lower.split(keyword)
            .length - 1;
      }

      return {
        ...chunk,
        score,
      };
    });

  scored.sort(
    (a, b) =>
      b.score - a.score
  );

  const selected =
    scored
      .filter(
        (chunk) =>
          chunk.score > 0
      )
      .slice(
        0,
        maxChunks
      );

  if (!selected.length) {
    return chunks.slice(
      0,
      maxChunks
    );
  }

  return selected;
}

/* =========================================================
   MARKDOWN CLEANING
========================================================= */

function cleanMarkdown(text) {
  if (!text) {
    return "";
  }

  let result = text;

  result = result.replace(
    /^```markdown\s*/i,
    ""
  );

  result = result.replace(
    /^```\s*/i,
    ""
  );

  result = result.replace(
    /\s*```$/i,
    ""
  );

  result = result.replace(
    /\$([^$]+)\$/g,
    "$1"
  );

  result = result.replace(
    /\\times/g,
    " × "
  );

  result = result.replace(
    /\\cdot/g,
    " · "
  );

  result = result.replace(
    /\\rightarrow/g,
    " → "
  );

  result = result.replace(
    /\\to/g,
    " → "
  );

  result = result.replace(
    /\\leq/g,
    " ≤ "
  );

  result = result.replace(
    /\\geq/g,
    " ≥ "
  );

  result = result.replace(
    /\\neq/g,
    " ≠ "
  );

  result = result.replace(
    /\\approx/g,
    " ≈ "
  );

  result = result.replace(
    /\\pm/g,
    " ± "
  );

  result = result.replace(
    /\\frac\{([^{}]+)\}\{([^{}]+)\}/g,
    "($1 / $2)"
  );

  result = result.replace(
    /\\text\{([^{}]+)\}/g,
    "$1"
  );

  result = result.replace(
    /\\left/g,
    ""
  );

  result = result.replace(
    /\\right/g,
    ""
  );

  result = result.replace(
    /\\mathbf\{([^{}]+)\}/g,
    "$1"
  );

  result = result.replace(
    /\\mathrm\{([^{}]+)\}/g,
    "$1"
  );

  return result.trim();
}

/* =========================================================
   GEMINI TEXT MODEL
========================================================= */

async function getGeminiModel() {
  if (!genAI) {
    throw new Error(
      "GEMINI_API_KEY is missing."
    );
  }

  let lastError = null;

  for (const modelName of GEMINI_MODELS) {
    try {
      console.log(
        `Testing Gemini model: ${modelName}`
      );

      const model =
        genAI.getGenerativeModel({
          model: modelName,
        });

      /*
         Do not actually send a request here.
         Just return the model.
      */

      return {
        model,
        modelName,
      };
    } catch (error) {
      lastError = error;

      console.error(
        `Model setup failed: ${modelName}`,
        error.message
      );
    }
  }

  throw (
    lastError ||
    new Error(
      "No Gemini model available."
    )
  );
}

/* =========================================================
   GEMINI TEXT GENERATION
========================================================= */

async function askGemini(prompt) {
  if (!genAI) {
    throw new Error(
      "Gemini API key is not configured."
    );
  }

  let lastError = null;

  for (const modelName of GEMINI_MODELS) {
    try {
      console.log(
        `Trying Gemini model: ${modelName}`
      );

      const model =
        genAI.getGenerativeModel({
          model: modelName,
        });

      const result =
        await model.generateContent(
          prompt
        );

      const text =
        result?.response?.text?.() ||
        "";

      if (!text.trim()) {
        throw new Error(
          "Gemini returned an empty answer."
        );
      }

      console.log(
        `Gemini success: ${modelName}`
      );

      return text.trim();
    } catch (error) {
      lastError = error;

      console.error(
        `Gemini failed: ${modelName}`
      );

      console.error(
        error.message
      );
    }
  }

  throw new Error(
    lastError?.message ||
      "All Gemini models failed."
  );
}

/* =========================================================
   TEXT PDF ANALYSIS
========================================================= */

async function analyzeTextPDF({
  text,
  question,
  mode,
}) {
  const chunks =
    createChunks(text);

  const relevant =
    retrieveRelevantChunks(
      chunks,
      question,
      10
    );

  const context =
    relevant
      .map(
        (chunk) =>
          `DOCUMENT SECTION ${chunk.id}\n${chunk.text}`
      )
      .join("\n\n");

  let task = "";

  if (mode === "summary") {
    task = `
Create a comprehensive study summary.

Include:
- Main topics
- Important concepts
- Definitions
- Formulas
- Examples
- Exam points
- Quick revision points
`;
  } else if (
    mode === "revision"
  ) {
    task = `
Create concise exam revision notes.

Include:
- Definitions
- Formulas
- Important facts
- Differences
- Steps
- Key concepts
`;
  } else if (
    mode === "mcq"
  ) {
    task = `
Create 10 MCQs from the document.

For each MCQ provide:
A. option
B. option
C. option
D. option
Correct answer
Short explanation
`;
  } else {
    task = `
Answer the student's question using
the document.
`;
  }

  const prompt = `
You are StudyMate AI, an academic
study assistant.

Use the supplied document material
as your primary source.

IMPORTANT:

- Do not invent information.
- Do not say the document is blank if
  useful document content is provided.
- Use simple language.
- Preserve technical terminology.
- Use clean Markdown.
- Use headings and bullet points.
- Make the answer useful for exams.
- Do not put the entire answer in a
  code block.
- Do not use raw LaTeX delimiters.

${task}

STUDENT QUESTION:

${
  question ||
  "Analyze the important content of this document."
}

DOCUMENT:

${context}
`;

  const answer =
    await askGemini(prompt);

  return cleanMarkdown(answer);
}

/* =========================================================
   DIRECT PDF ANALYSIS
========================================================= */

/*
   THIS IS THE MAIN FIX FOR YOUR SCREENSHOT.

   We send the ORIGINAL PDF bytes to Gemini.

   We do NOT tell Gemini that the PDF is
   blank simply because pdf-parse failed.
*/

async function analyzePDFDirectly({
  pdfBuffer,
  filename,
  question,
  mode,
}) {
  if (!genAI) {
    throw new Error(
      "Gemini API key is missing."
    );
  }

  console.log("");
  console.log(
    "=========================================="
  );
  console.log(
    "DIRECT PDF ANALYSIS"
  );
  console.log(
    "=========================================="
  );

  console.log(
    `File: ${filename}`
  );

  console.log(
    `Size: ${pdfBuffer.length} bytes`
  );

  const base64PDF =
    pdfBuffer.toString(
      "base64"
    );

  let task = "";

  if (mode === "summary") {
    task = `
Read the ENTIRE PDF and create detailed
study notes.

Cover:
1. Main topics
2. Important concepts
3. Definitions
4. Formulas
5. Examples
6. Tables
7. Diagrams
8. Important exam points
9. Quick revision
`;
  } else if (
    mode === "revision"
  ) {
    task = `
Read the ENTIRE PDF and create quick
exam revision notes.

Focus on:
- Definitions
- Formulas
- Key concepts
- Differences
- Important facts
- Steps
- Exam keywords
`;
  } else if (
    mode === "mcq"
  ) {
    task = `
Read the ENTIRE PDF and create 15
important exam-oriented MCQs.

Each MCQ must contain:
- Question
- A
- B
- C
- D
- Correct answer
- Explanation
`;
  } else {
    task = `
Read the actual PDF and answer the
student's question.

You MUST inspect the actual document
content.

The PDF may be:

- a normal text PDF
- a scanned PDF
- an image-based PDF
- a textbook
- lecture notes
- a PDF containing diagrams
- a PDF containing tables
- a PDF containing formulas

If the PDF is scanned or image-based,
use the visible page content.

Do NOT conclude that pages are blank
just because normal text extraction
failed.

Only say that a page is blank if the
actual page is visually blank.
`;
  }

  const prompt = `
You are StudyMate AI.

You are given the student's actual
PDF file.

Analyze the ACTUAL PDF.

IMPORTANT RULES:

1. Inspect the PDF pages.

2. Do not rely only on machine text
   extraction.

3. The PDF can contain scanned images.

4. Read visible text from scanned pages.

5. Understand diagrams.

6. Understand tables.

7. Understand formulas.

8. Preserve important terminology.

9. Do not invent information.

10. Do not claim that the PDF is blank
    merely because text extraction
    returned little or no text.

11. If the pages contain readable
    academic material, use that material.

12. Use clean Markdown.

13. Use headings.

14. Use bullet points.

15. Use numbered lists.

16. Do not put the complete answer in
    a code block.

17. Do not use raw LaTeX such as
    $...$.

18. Make the result useful for a
    college student preparing for exams.

${task}

STUDENT QUESTION:

${
  question ||
  "Analyze this PDF and create detailed study notes from its actual content."
}

The PDF file is attached as PDF data.
Read the actual PDF now.
`;

  let lastError = null;

  for (const modelName of GEMINI_MODELS) {
    try {
      console.log(
        `Sending PDF to Gemini: ${modelName}`
      );

      const model =
        genAI.getGenerativeModel({
          model: modelName,
        });

      /*
         IMPORTANT:
         The PDF itself is sent as inlineData.
      */

      const result =
        await model.generateContent([
          {
            inlineData: {
              mimeType:
                "application/pdf",
              data: base64PDF,
            },
          },
          {
            text: prompt,
          },
        ]);

      const response =
        result?.response;

      const answer =
        response?.text?.() ||
        "";

      if (!answer.trim()) {
        throw new Error(
          "Gemini returned an empty PDF answer."
        );
      }

      console.log(
        `PDF analysis success: ${modelName}`
      );

      return cleanMarkdown(
        answer
      );
    } catch (error) {
      lastError = error;

      console.error(
        `PDF analysis failed: ${modelName}`
      );

      console.error(
        error.message
      );
    }
  }

  throw new Error(
    lastError?.message ||
      "Gemini could not analyze the PDF."
  );
}

/* =========================================================
   SAVE DOCUMENT
========================================================= */

function saveDocument(
  file,
  extractedText
) {
  const documentId =
    String(nextDocumentId++);

  const chunks =
    createChunks(
      extractedText
    );

  documents.set(
    documentId,
    {
      id: documentId,
      filename:
        file.originalname,
      mimetype:
        file.mimetype,
      size:
        file.size,
      buffer:
        file.buffer,
      text:
        extractedText,
      chunks,
      createdAt:
        new Date().toISOString(),
    }
  );

  return documentId;
}

/* =========================================================
   UPLOAD HANDLER
========================================================= */

async function handleUpload(
  req,
  res
) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error:
          "No PDF file uploaded.",
      });
    }

    console.log("");
    console.log(
      "=========================================="
    );
    console.log(
      "PDF UPLOAD"
    );
    console.log(
      "=========================================="
    );

    console.log(
      "Filename:",
      req.file.originalname
    );

    console.log(
      "Size:",
      req.file.size,
      "bytes"
    );

    let extractedText = "";

    try {
      extractedText =
        await extractPDFText(
          req.file.buffer
        );

      extractedText =
        cleanText(
          extractedText
        );
    } catch (error) {
      console.error(
        error.message
      );
    }

    console.log(
      "Extracted characters:",
      extractedText.length
    );

    const documentId =
      saveDocument(
        req.file,
        extractedText
      );

    return res.json({
      success: true,
      documentId,
      filename:
        req.file.originalname,
      extractedCharacters:
        extractedText.length,
      textAvailable:
        extractedText.length > 0,
      message:
        "PDF uploaded successfully.",
    });
  } catch (error) {
    console.error(
      "UPLOAD ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "PDF upload failed.",
    });
  }
}

/* =========================================================
   ANALYZE HANDLER
========================================================= */

async function handleAnalyze(
  req,
  res
) {
  try {
    const question =
      req.body?.question ||
      req.body?.prompt ||
      req.body?.query ||
      "";

    const mode =
      req.body?.mode ||
      "notes";

    console.log("");
    console.log(
      "=========================================="
    );
    console.log(
      "AI ANALYSIS REQUEST"
    );
    console.log(
      "=========================================="
    );

    console.log(
      "Question:",
      question ||
        "(full PDF analysis)"
    );

    console.log(
      "Mode:",
      mode
    );

    /* -----------------------------------------------------
       DIRECT PDF RECEIVED
    ----------------------------------------------------- */

    if (req.file) {
      console.log(
        "PDF received directly from frontend."
      );

      /*
         Extract text only for diagnostics
         and possible RAG use.

         We NEVER use lack of extracted text
         as proof that the PDF is blank.
      */

      let extractedText = "";

      try {
        extractedText =
          await extractPDFText(
            req.file.buffer
          );

        extractedText =
          cleanText(
            extractedText
          );
      } catch (error) {
        console.error(
          "Extraction failed:",
          error.message
        );
      }

      console.log(
        `Extracted text: ${extractedText.length} characters`
      );

      /*
         IMPORTANT:
         For PDFs, DIRECT ANALYSIS is now
         preferred.

         This is especially important for
         scanned/image PDFs.
      */

      console.log(
        "Using direct PDF analysis."
      );

      try {
        const answer =
          await analyzePDFDirectly({
            pdfBuffer:
              req.file.buffer,
            filename:
              req.file.originalname,
            question,
            mode,
          });

        return res.json({
          success: true,
          answer,
          source:
            "gemini-direct-pdf",
          extractedCharacters:
            extractedText.length,
        });
      } catch (directError) {
        console.error(
          "Direct PDF analysis failed."
        );

        console.error(
          directError.message
        );

        /*
           If direct PDF analysis fails,
           fall back to extracted text when
           available.
        */

        if (
          extractedText.length >=
          500
        ) {
          console.log(
            "Falling back to text/RAG analysis."
          );

          const answer =
            await analyzeTextPDF({
              text:
                extractedText,
              question,
              mode,
            });

          return res.json({
            success: true,
            answer,
            source:
              "text-rag-fallback",
            extractedCharacters:
              extractedText.length,
          });
        }

        throw directError;
      }
    }

    /* -----------------------------------------------------
       DOCUMENT ID
    ----------------------------------------------------- */

    const documentId =
      req.body?.documentId ||
      req.body?.id;

    if (documentId) {
      const document =
        documents.get(
          String(documentId)
        );

      if (!document) {
        return res.status(404).json({
          success: false,
          error:
            "Document not found. Please upload the PDF again.",
        });
      }

      /*
         Try direct PDF first.
      */

      try {
        const answer =
          await analyzePDFDirectly({
            pdfBuffer:
              document.buffer,
            filename:
              document.filename,
            question,
            mode,
          });

        return res.json({
          success: true,
          answer,
          source:
            "gemini-direct-pdf",
          documentId:
            document.id,
          filename:
            document.filename,
        });
      } catch (directError) {
        console.error(
          "Direct stored-PDF analysis failed:",
          directError.message
        );
      }

      /*
         Text fallback.
      */

      if (
        document.text &&
        document.text.length >=
          500
      ) {
        const answer =
          await analyzeTextPDF({
            text:
              document.text,
            question,
            mode,
          });

        return res.json({
          success: true,
          answer,
          source:
            "text-rag-fallback",
          documentId:
            document.id,
          filename:
            document.filename,
        });
      }

      return res.status(500).json({
        success: false,
        error:
          "Gemini could not analyze this PDF.",
      });
    }

    return res.status(400).json({
      success: false,
      error:
        "No PDF or documentId was provided.",
    });
  } catch (error) {
    console.error("");
    console.error(
      "=========================================="
    );
    console.error(
      "AI ANALYSIS ERROR"
    );
    console.error(
      "=========================================="
    );

    console.error(
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "AI analysis failed.",
    });
  }
}

/* =========================================================
   API ROUTES
========================================================= */

/*
   Standard upload
*/

app.post(
  "/upload",
  upload.single("pdf"),
  handleUpload
);

/*
   API upload
*/

app.post(
  "/api/upload",
  upload.single("pdf"),
  handleUpload
);

/*
   IMPORTANT:
   Your existing App.jsx uses this route.
*/

app.post(
  "/api/upload-pdf",
  upload.single("pdf"),
  handleAnalyze
);

/*
   Standard analyze
*/

app.post(
  "/analyze",
  upload.single("pdf"),
  handleAnalyze
);

/*
   API analyze
*/

app.post(
  "/api/analyze",
  upload.single("pdf"),
  handleAnalyze
);

/* =========================================================
   404 HANDLER
========================================================= */

app.use(
  (req, res) => {
    console.log(
      `404: ${req.method} ${req.originalUrl}`
    );

    res.status(404).json({
      success: false,
      error:
        "API route not found.",
      path:
        req.originalUrl,
      method:
        req.method,
    });
  }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (error, req, res, next) => {
    console.error(
      "SERVER ERROR:",
      error
    );

    if (
      error instanceof
      multer.MulterError
    ) {
      return res.status(400).json({
        success: false,
        error:
          `Upload error: ${error.message}`,
      });
    }

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Internal server error.",
    });
  }
);

/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {
    console.log("");
    console.log(
      "=========================================="
    );
    console.log(
      "          STUDYMATE AI BACKEND"
    );
    console.log(
      "=========================================="
    );

    console.log(
      `Server: http://localhost:${PORT}`
    );

    console.log(
      "PDF upload: ENABLED"
    );

    console.log(
      "PDF parsing: ENABLED"
    );

    console.log(
      "Direct PDF analysis: ENABLED"
    );

    console.log(
      "Scanned PDF support: ENABLED"
    );

    console.log(
      `Gemini AI: ${
        GEMINI_API_KEY
          ? "ENABLED"
          : "DISABLED"
      }`
    );

    console.log(
      "Maximum PDF size: 50 MB"
    );

    console.log(
      "/api/upload-pdf: ENABLED"
    );

    console.log(
      "/api/analyze: ENABLED"
    );

    console.log(
      "=========================================="
    );

    console.log("");
  }
);