import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

function cleanAIText(text) {
  if (!text) return "";

  return text
    // Remove LaTeX delimiters
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/\\\((.*?)\\\)/g, "$1")
    .replace(/\\\[(.*?)\\\]/gs, "$1")

    // Common LaTeX commands
    .replace(/\\circ/g, "°")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\pm/g, "±")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\approx/g, "≈")
    .replace(/\\rightarrow/g, "→")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\mathrm\{([^}]*)\}/g, "$1")
    .replace(/\\mathbf\{([^}]*)\}/g, "$1")
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1 / $2)")

    // Remove excessive markdown artifacts
    .replace(/```markdown/gi, "")
    .replace(/```text/gi, "")
    .replace(/```/g, "")

    // Clean escaped markdown characters
    .replace(/\\([*_#])/g, "$1");
}

function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [selectedFile, setSelectedFile] = useState(null);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Please select a PDF file.");
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setError("PDF must be smaller than 50 MB.");
      return;
    }

    setSelectedFile(file);
    setError("");
    setAnswer("");
  };

  const analyzePDF = async () => {
    if (!selectedFile) {
      setError("Please choose a PDF first.");
      return;
    }

    setLoading(true);
    setError("");
    setAnswer("");

    try {
      const formData = new FormData();

      formData.append("pdf", selectedFile);

      formData.append(
        "prompt",
        `
Analyze this PDF carefully and create high-quality study material.

IMPORTANT:
- Read the actual PDF content.
- Cover the important sections and topics.
- Do not claim that the PDF is blank unless it truly contains no readable information.
- Do not invent information.
- Use simple student-friendly language.
- Organize the response professionally.

FORMAT THE RESPONSE LIKE THIS:

# Document Overview

Give a short overview of the document.

## 1. Main Topics

List the major topics covered.

## 2. Detailed Notes

Explain every important topic using:
- clear headings
- short paragraphs
- bullet points
- definitions
- examples
- important concepts

## 3. Formulas

Show important formulas in a clean readable format.

## 4. Comparisons

Use tables whenever two or more concepts are being compared.

## 5. Important Examples

Explain important examples or numerical concepts.

## 6. Exam Important Points

Give the points most useful for exam preparation.

## 7. Quick Revision

Finish with concise revision notes.

Avoid unnecessary repetition.
        `
      );

      const response = await fetch(`${API_URL}/api/analyze`, {
        method: "POST",
        body: formData,
      });

          if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `Server error: ${response.status}`);
    }

      const data = await response.json();

      const generatedAnswer =
        data.answer ||
        data.response ||
        data.result ||
        data.text ||
        "";

      if (!generatedAnswer) {
        throw new Error("The AI returned an empty response.");
      }

      setAnswer(generatedAnswer);

      setHistory((previous) => [
        {
          id: Date.now(),
          name: selectedFile.name,
          date: new Date().toLocaleString(),
        },
        ...previous,
      ]);

      setActivePage("Study Room");
    } catch (err) {
      console.error(err);

      setError(
        err.message ||
          "Something went wrong while analyzing the PDF."
      );
    } finally {
      setLoading(false);
    }
  };

  const clearWorkspace = () => {
    setSelectedFile(null);
    setAnswer("");
    setError("");
  };

  const renderDashboard = () => (
    <div className="page-container">
      <section className="hero-card">
        <div className="hero-content">
          <div className="hero-badge">
            <span>✦</span>
            AI-POWERED LEARNING
          </div>

          <h1>
            Turn your PDFs into
            <span> smarter study material.</span>
          </h1>

          <p>
            Upload your lecture notes, textbooks or study PDFs and let
            StudyMate transform them into clear notes, summaries and
            exam-ready material.
          </p>

          <div className="hero-stats">
            <div>
              <strong>AI</strong>
              <span>Powered</span>
            </div>

            <div>
              <strong>PDF</strong>
              <span>Analysis</span>
            </div>

            <div>
              <strong>24/7</strong>
              <span>Study Help</span>
            </div>
          </div>
        </div>

        <div className="hero-visual">
          <div className="floating-book book-one">📘</div>
          <div className="floating-book book-two">📚</div>
          <div className="ai-orb">
            <span>✦</span>
            <small>AI</small>
          </div>
        </div>
      </section>

      <section className="upload-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">START STUDYING</p>
            <h2>Upload your study PDF</h2>
            <p>
              Add a PDF and StudyMate will turn it into structured study
              material.
            </p>
          </div>

          {selectedFile && (
            <button className="ghost-button" onClick={clearWorkspace}>
              Clear
            </button>
          )}
        </div>

        <div className="upload-box">
          <input
            id="pdf-upload"
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            hidden
          />

          <label htmlFor="pdf-upload" className="upload-icon">
            📄
          </label>

          <h3>
            {selectedFile
              ? selectedFile.name
              : "Choose a PDF to get started"}
          </h3>

          <p>
            {selectedFile
              ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • PDF`
              : "Maximum file size: 50 MB"}
          </p>

          <label htmlFor="pdf-upload" className="choose-button">
            {selectedFile ? "Change PDF" : "Choose PDF"}
          </label>

          {selectedFile && (
            <button
              className="analyze-button"
              onClick={analyzePDF}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner"></span>
                  Analyzing PDF...
                </>
              ) : (
                <>
                  ✨ Analyze with AI
                </>
              )}
            </button>
          )}

          {error && <div className="error-message">⚠ {error}</div>}
        </div>
      </section>

      <section className="tools-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">AI TOOLS</p>
            <h2>What can StudyMate create?</h2>
          </div>
        </div>

        <div className="tools-grid">
          <ToolCard
            icon="📝"
            title="AI Notes"
            description="Convert your PDF into clean, structured study notes."
            color="purple"
            onClick={() => setActivePage("Study Room")}
          />

          <ToolCard
            icon="✨"
            title="Smart Summary"
            description="Get a concise summary of the complete document."
            color="blue"
            onClick={() => setActivePage("Study Room")}
          />

          <ToolCard
            icon="✓"
            title="MCQ Generator"
            description="Create important practice questions automatically."
            color="green"
          />

          <ToolCard
            icon="🎯"
            title="Exam Prep"
            description="Find important topics and last-minute revision points."
            color="orange"
          />
        </div>
      </section>

      <section className="feature-strip">
        <div className="feature-item">
          <span>⚡</span>
          <div>
            <strong>Fast AI Analysis</strong>
            <p>Turn lengthy documents into useful study material.</p>
          </div>
        </div>

        <div className="feature-item">
          <span>🎓</span>
          <div>
            <strong>Exam Focused</strong>
            <p>Important definitions, concepts and revision points.</p>
          </div>
        </div>

        <div className="feature-item">
          <span>🔒</span>
          <div>
            <strong>Simple Workflow</strong>
            <p>Upload → Analyze → Study.</p>
          </div>
        </div>
      </section>
    </div>
  );

  const renderStudyRoom = () => (
    <div className="page-container">
      <div className="study-header">
        <div>
          <p className="eyebrow">STUDY ROOM</p>
          <h1>Your AI-generated study material</h1>
          <p>
            Review your PDF analysis in a clean, easy-to-read format.
          </p>
        </div>

        <button
          className="primary-small-button"
          onClick={() => setActivePage("Dashboard")}
        >
          + New PDF
        </button>
      </div>

      {!answer && !loading && (
        <div className="empty-state">
          <div className="empty-icon">📚</div>
          <h2>No study material yet</h2>
          <p>
            Upload a PDF from the dashboard to generate your study
            material.
          </p>
          <button
            className="primary-button"
            onClick={() => setActivePage("Dashboard")}
          >
            Upload PDF
          </button>
        </div>
      )}

      {loading && (
        <div className="loading-card">
          <div className="loading-orb">
            <span>✦</span>
          </div>

          <h2>StudyMate is analyzing your PDF</h2>

          <p>
            Reading the document and preparing your study material...
          </p>

          <div className="loading-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>

          <small>
            Large PDFs may take a little longer.
          </small>
        </div>
      )}

      {answer && !loading && (
        <article className="answer-card">
          <div className="answer-top">
            <div>
              <span className="answer-label">AI STUDY NOTES</span>
              <h2>{selectedFile?.name || "Study Material"}</h2>
            </div>

            <button
              className="secondary-button"
              onClick={() => {
                navigator.clipboard?.writeText(cleanAIText(answer));
              }}
            >
              📋 Copy
            </button>
          </div>

          <div className="answer-divider"></div>

          <div className="markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {cleanAIText(answer)}
            </ReactMarkdown>
          </div>
        </article>
      )}
    </div>
  );

  const renderHistory = () => (
    <div className="page-container">
      <div className="study-header">
        <div>
          <p className="eyebrow">HISTORY</p>
          <h1>Your study sessions</h1>
          <p>Recently analyzed documents appear here.</p>
        </div>
      </div>

      {history.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🕘</div>
          <h2>No history yet</h2>
          <p>
            Analyze your first PDF and it will appear here.
          </p>
        </div>
      ) : (
        <div className="history-list">
          {history.map((item) => (
            <div className="history-item" key={item.id}>
              <div className="history-file-icon">📄</div>

              <div className="history-info">
                <strong>{item.name}</strong>
                <span>{item.date}</span>
              </div>

              <button
                className="secondary-button"
                onClick={() => setActivePage("Study Room")}
              >
                Open
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const pageContent = () => {
    if (activePage === "Study Room") return renderStudyRoom();
    if (activePage === "History") return renderHistory();

    return renderDashboard();
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <span>📚</span>
          </div>

          <div>
            <strong>StudyMate</strong>
            <small>AI Study Assistant</small>
          </div>
        </div>

        <nav className="navigation">
          <p className="nav-title">MAIN</p>

          <NavItem
            icon="⌂"
            label="Dashboard"
            active={activePage === "Dashboard"}
            onClick={() => setActivePage("Dashboard")}
          />

          <NavItem
            icon="▣"
            label="Study Room"
            active={activePage === "Study Room"}
            onClick={() => setActivePage("Study Room")}
          />

          <NavItem
            icon="◷"
            label="History"
            active={activePage === "History"}
            onClick={() => setActivePage("History")}
          />

          <p className="nav-title ai-title">AI TOOLS</p>

          <NavItem
            icon="📝"
            label="AI Notes"
            onClick={() => setActivePage("Study Room")}
          />

          <NavItem
            icon="✓"
            label="MCQ Generator"
            onClick={() => setActivePage("Study Room")}
          />

          <NavItem
            icon="🎯"
            label="Exam Prep"
            onClick={() => setActivePage("Study Room")}
          />
        </nav>

        <div className="sidebar-bottom">
          <div className="ai-status">
            <span className="status-dot"></span>
            <div>
              <strong>AI Assistant</strong>
              <small>Ready to help</small>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="search-container">
            <span>⌕</span>

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your study workspace..."
            />

            <kbd>Ctrl K</kbd>
          </div>

          <div className="topbar-actions">
            <button className="icon-button" title="Notifications">
              🔔
            </button>

            <div className="profile-avatar">K</div>
          </div>
        </header>

        <div className="content-area">{pageContent()}</div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }) {
  return (
    <button
      className={`nav-item ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <span className="nav-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function ToolCard({ icon, title, description, color, onClick }) {
  return (
    <button className="tool-card" onClick={onClick}>
      <div className={`tool-icon ${color}`}>{icon}</div>

      <div className="tool-content">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>

      <span className="tool-arrow">→</span>
    </button>
  );
}

export default App;