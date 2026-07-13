import React, { useState, useEffect, useCallback, useMemo } from "react";
import { dashboardFetch } from "../utils/fetch";
import "./kb.css";

const MODES = {
  prompt: { label: "Always loaded", hint: "Included in every conversation. Best for rules, company info, and critical policies — keep it concise." },
  auto: { label: "Retrieved (RAG)", hint: "Pulled in only when relevant to the question. Best for large catalogs, guides, and FAQs." },
};

const EMPTY = { id: null, name: "", content: "", usage_mode: "auto" };

export default function KnowledgeBasePage() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(null); // null = nothing open
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [banner, setBanner] = useState(null);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await dashboardFetch("/api/dashboard/knowledge-base");
      setDocs(data.items || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const openDoc = (doc) => { setSelectedId(doc.id); setForm({ id: doc.id, name: doc.name, content: doc.content || "", usage_mode: doc.usage_mode || "auto" }); setError(null); };
  const openNew = () => { setSelectedId(null); setForm({ ...EMPTY }); setError(null); };

  const flash = (msg) => { setBanner(msg); setTimeout(() => setBanner(null), 3500); };

  const handleSave = async () => {
    if (!form?.name.trim() || !form?.content.trim()) return;
    setSaving(true); setError(null);
    try {
      const body = JSON.stringify({ name: form.name.trim(), content: form.content.trim(), usage_mode: form.usage_mode });
      if (form.id) await dashboardFetch(`/api/dashboard/knowledge-base?id=${form.id}`, { method: "PATCH", body });
      else await dashboardFetch("/api/dashboard/knowledge-base", { method: "POST", body });
      await fetchDocs();
      flash(form.id ? "Document saved." : "Document created.");
      if (!form.id) setForm(null);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!form?.id) return;
    if (!window.confirm(`Delete "${form.name}"? This removes it from the AI's knowledge base permanently.`)) return;
    setSaving(true); setError(null);
    try {
      await dashboardFetch(`/api/dashboard/knowledge-base?id=${form.id}`, { method: "DELETE" });
      setForm(null); setSelectedId(null);
      await fetchDocs();
      flash("Document deleted.");
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? docs.filter((d) => d.name.toLowerCase().includes(q) || (d.content || "").toLowerCase().includes(q)) : docs;
  }, [docs, search]);

  const canSave = form && form.name.trim() && form.content.trim();

  return (
    <div className="kb">
      <div className="kb-head">
        <h1>Knowledge Base</h1>
        <span className="sub">{docs.length} document{docs.length === 1 ? "" : "s"} teaching the AI about your products, policies, and FAQs</span>
        <input className="kb-search" placeholder="Search documents…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="kb-new" onClick={openNew}>+ New document</button>
      </div>

      {error && <div className="kb-banner err" onClick={() => setError(null)}>{error} — dismiss</div>}
      {banner && <div className="kb-banner ok">{banner}</div>}

      <div className="kb-body">
        {/* List */}
        <div className="kb-list">
          <div className="kb-list-scroll">
            {loading && <div className="kb-empty" style={{ minHeight: 120 }}>Loading…</div>}
            {!loading && visible.length === 0 && <div className="kb-empty" style={{ minHeight: 120 }}><div className="t">No documents</div><div>Create one to get started.</div></div>}
            {visible.map((doc) => {
              const mode = MODES[doc.usage_mode] || MODES.auto;
              return (
                <div key={doc.id} className={`kb-doc ${doc.id === selectedId ? "is-active" : ""}`} onClick={() => openDoc(doc)}>
                  <div className="kb-doc-top"><span className="kb-doc-name">{doc.name}</span></div>
                  <div className="kb-doc-sub">
                    <span className={`kb-mode ${doc.usage_mode === "prompt" ? "prompt" : "auto"}`}>{mode.label}</span>
                    <span className="kb-size">{doc.content ? `${doc.content.length.toLocaleString()} chars` : "empty"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Editor */}
        <div className="kb-editor">
          {!form ? (
            <div className="kb-empty">
              <div className="t">Select a document</div>
              <div>Pick one on the left to edit, or create a new document.</div>
              <button className="kb-new" style={{ marginTop: 8 }} onClick={openNew}>+ New document</button>
            </div>
          ) : (
            <>
              <div className="kb-editor-body">
                <div className="kb-field">
                  <label className="kb-label">Document name</label>
                  <input className="kb-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Shipping Policy, Product FAQ" />
                </div>

                <div className="kb-field">
                  <label className="kb-label">How the AI uses it</label>
                  <div className="kb-modes">
                    {Object.entries(MODES).map(([key, m]) => (
                      <button key={key} type="button" className={`kb-mode-card ${form.usage_mode === key ? "is-on" : ""}`} onClick={() => setForm({ ...form, usage_mode: key })}>
                        <div className="t">{m.label}</div>
                        <div className="d">{m.hint}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="kb-field">
                  <label className="kb-label">Content</label>
                  <textarea className="kb-content" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Enter the knowledge content. Plain text or markdown." />
                  <div className="kb-count">{form.content.length.toLocaleString()} characters{form.usage_mode === "prompt" && form.content.length > 5000 ? " · long for an always-loaded doc — consider RAG" : ""}</div>
                </div>
              </div>

              <div className="kb-editor-foot">
                <div>{form.id ? <button className="kb-btn kb-btn-danger" disabled={saving} onClick={handleDelete}>Delete</button> : <span className="kb-size">New document</span>}</div>
                <div className="kb-foot-actions">
                  <button className="kb-btn" onClick={() => { setForm(null); setSelectedId(null); }}>Close</button>
                  <button className="kb-btn kb-btn-primary" disabled={!canSave || saving} onClick={handleSave}>{saving ? "Saving…" : form.id ? "Save changes" : "Create document"}</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
