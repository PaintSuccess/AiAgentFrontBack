import React, { useState, useEffect, useCallback } from "react";
import { dashboardFetch } from "../utils/fetch";
import "./inbox.css";

const CHANNELS = { sms: "SMS", whatsapp: "WhatsApp", chat: "Chat", voice: "Voice", email: "Email" };
const AVATAR_COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#6366f1", "#f97316"];
const hashStr = (s) => { let h = 0; for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) | 0; return Math.abs(h); };
const avatarColor = (seed) => AVATAR_COLORS[hashStr(seed || "?") % AVATAR_COLORS.length];
function initials(name, phone) {
  const n = String(name || "").trim();
  if (n) { const p = n.split(/\s+/); return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || n.slice(0, 2).toUpperCase(); }
  const d = String(phone || "").replace(/\D/g, "");
  return d ? d.slice(-2) : "?";
}
function timeAgo(iso) { if (!iso) return ""; const d = (Date.now() - new Date(iso).getTime()) / 1000; if (d < 60) return "now"; if (d < 3600) return `${Math.floor(d / 60)}m`; if (d < 86400) return `${Math.floor(d / 3600)}h`; return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" }); }

export default function ContactsPage({ onOpenThread }) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      const d = await dashboardFetch(`/api/comms/contacts?${p}`);
      setItems(d.items || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [q]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div className="pa-contacts">
      <div className="pa-contacts-head">
        <h1>Contacts</h1>
        <input className="pa-search" placeholder="Search name, phone, email…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="pa-contacts-list">
        {!loading && items.length === 0 && <div className="pa-muted" style={{ padding: 20 }}>No contacts found.</div>}
        {items.map((ct) => {
          const thread = (ct.threads || [])[0];
          const nm = ct.name || ct.phone || ct.email || "Unknown";
          return (
            <div key={ct.id} className="pa-contact-row" onClick={() => thread && onOpenThread(thread.id)}>
              <div className="pa-avatar" style={{ background: avatarColor(ct.phone || nm) }}>{initials(ct.name, ct.phone)}</div>
              <div className="pa-contact-meta">
                <div className="nm">{nm}</div>
                <div className="sub">{ct.phone || ""}{ct.email ? ` · ${ct.email}` : ""}{ct.shopify_customer_id ? " · Shopify customer" : ""}</div>
              </div>
              <div className="pa-muted" style={{ textAlign: "right" }}>
                {thread && <div>{timeAgo(thread.last_message_at)}</div>}
                {thread?.last_channel && <div style={{ fontSize: 11 }}>{CHANNELS[thread.last_channel]}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
