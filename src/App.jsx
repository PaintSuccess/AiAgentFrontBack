import React, { useState } from "react";
import InboxPage from "./pages/InboxPage";
import ContactsPage from "./pages/ContactsPage";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";
import "./app-shell.css";

const InboxIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5h16v11H8l-4 4V5z" /><path d="M8 9h8M8 12.5h5" />
  </svg>
);
const ContactsIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 6.5a3 3 0 0 1 0 5.5M20.5 19a5 5 0 0 0-4-4.9" />
  </svg>
);
const KbIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z" /><path d="M8 7h8M8 10.5h6" />
  </svg>
);

const NAV = [
  { key: "inbox", label: "Inbox", icon: InboxIcon },
  { key: "contacts", label: "Contacts", icon: ContactsIcon },
  { key: "knowledge-base", label: "Knowledge", icon: KbIcon },
];

export default function App() {
  const [page, setPage] = useState("inbox");
  const [openThreadId, setOpenThreadId] = useState(null);

  const openThread = (threadId) => { setOpenThreadId(threadId); setPage("inbox"); };

  return (
    <div className="pa-shell">
      <nav className="pa-rail">
        <div className="pa-rail-logo" title="Paint Access">PA</div>
        {NAV.map((n) => (
          <button key={n.key} className={`pa-rail-btn ${page === n.key ? "is-active" : ""}`} onClick={() => setPage(n.key)} title={n.label}>
            <span className="pa-rail-ic">{n.icon}</span>
            <span className="pa-rail-label">{n.label}</span>
          </button>
        ))}
      </nav>
      <main className="pa-content">
        {page === "inbox" && <InboxPage initialThreadId={openThreadId} />}
        {page === "contacts" && <ContactsPage onOpenThread={openThread} />}
        {page === "knowledge-base" && <KnowledgeBasePage onBack={() => setPage("inbox")} />}
      </main>
    </div>
  );
}
