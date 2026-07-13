import React, { useState } from "react";
import InboxPage from "./pages/InboxPage";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";
import "./app-shell.css";

const InboxIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5h16v11H8l-4 4V5z" />
    <path d="M8 9h8M8 12.5h5" />
  </svg>
);
const KbIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z" />
    <path d="M8 7h8M8 10.5h6" />
  </svg>
);

const NAV = [
  { key: "inbox", label: "Inbox", icon: InboxIcon },
  { key: "knowledge-base", label: "Knowledge", icon: KbIcon },
];

export default function App() {
  const [page, setPage] = useState("inbox");

  return (
    <div className="pa-shell">
      <nav className="pa-rail">
        <div className="pa-rail-logo" title="Paint Access">PA</div>
        {NAV.map((n) => (
          <button
            key={n.key}
            className={`pa-rail-btn ${page === n.key ? "is-active" : ""}`}
            onClick={() => setPage(n.key)}
            title={n.label}
          >
            <span className="pa-rail-ic">{n.icon}</span>
            <span className="pa-rail-label">{n.label}</span>
          </button>
        ))}
      </nav>
      <main className="pa-content">
        {page === "inbox" && <InboxPage />}
        {page === "knowledge-base" && <KnowledgeBasePage onBack={() => setPage("inbox")} />}
      </main>
    </div>
  );
}
