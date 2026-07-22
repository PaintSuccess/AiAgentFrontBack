import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { dashboardFetch } from "../utils/fetch";
import { ADMIN_BASE, money, dateShort, statusTone } from "../utils/shopify";
import "./inbox.css";

const CHANNELS = {
  sms: { label: "SMS", color: "#2f7ed8" },
  whatsapp: { label: "WhatsApp", color: "#25b366" },
  chat: { label: "Chat", color: "#7a5af8" },
  voice: { label: "Voice", color: "#f59e0b" },
  email: { label: "Email", color: "#ec4899" },
};
const SENDABLE = [{ value: "sms", label: "SMS" }, { value: "whatsapp", label: "WhatsApp" }];

// Storefront browsing events (from our own Shopify web pixel), for the contact panel.
const BROWSE_ICON = {
  product_viewed: "🔍",
  product_added_to_cart: "🛒",
  product_removed_from_cart: "✕",
  cart_viewed: "🛒",
  collection_viewed: "🗂",
  search_submitted: "⌕",
  page_viewed: "📄",
};
const BROWSE_VERB = {
  product_viewed: "Viewed",
  product_added_to_cart: "Added to cart",
  product_removed_from_cart: "Removed from cart",
  cart_viewed: "Viewed cart",
  collection_viewed: "Browsed",
  search_submitted: "Searched",
  page_viewed: "Visited",
};
// Browsing URLs come from the public pixel endpoint, so treat them as untrusted: only allow
// them as an href when the scheme is http(s). Returns undefined for anything else.
function safeBrowseHref(url) {
  return /^https?:\/\//i.test(String(url || "")) ? url : undefined;
}
// A readable label: prefer the product/collection title; otherwise a short path from the URL.
function browseLabel(e) {
  const verb = BROWSE_VERB[e.name] || "Visited";
  if (e.name === "search_submitted") return e.query ? `Searched “${e.query}”` : "Searched the store";
  if (e.productTitle) return `${verb} ${e.productTitle}`;
  if (e.name === "cart_viewed") return "Viewed cart";
  let tail = "";
  try {
    const u = new URL(e.url);
    tail = decodeURIComponent(u.pathname.replace(/\/$/, "").split("/").pop() || "").replace(/-/g, " ");
  } catch { /* ignore */ }
  return tail ? `${verb} ${tail}` : verb;
}
const FOLDERS = [
  { value: "all", label: "All conversations" },
  { value: "unread", label: "Unread" },
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "closed", label: "Closed" },
  { value: "starred", label: "Starred" },
  { value: "pinned", label: "Pinned" },
  { value: "mine", label: "Assigned to me" },
  { value: "unassigned", label: "Unassigned" },
];
const STATUSES = [{ value: "open", label: "Open" }, { value: "pending", label: "Pending" }, { value: "closed", label: "Closed" }];
const AVATAR_COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#6366f1", "#f97316"];
const THREADS_POLL_MS = 6000;
const THREAD_POLL_MS = 4000;

const hashStr = (s) => { let h = 0; for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) | 0; return Math.abs(h); };
const avatarColor = (seed) => AVATAR_COLORS[hashStr(seed || "?") % AVATAR_COLORS.length];
function initials(name, phone) {
  const n = String(name || "").trim();
  if (n) { const p = n.split(/\s+/); return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || n.slice(0, 2).toUpperCase(); }
  const d = String(phone || "").replace(/\D/g, "");
  return d ? d.slice(-2) : "?";
}
const contactName = (c) => (!c ? "Unknown" : c.name || c.email || c.phone || "Unknown");
function timeAgo(iso) { if (!iso) return ""; const d = (Date.now() - new Date(iso).getTime()) / 1000; if (d < 60) return "now"; if (d < 3600) return `${Math.floor(d / 60)}m`; if (d < 86400) return `${Math.floor(d / 3600)}h`; return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" }); }
const clockTime = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" }) : "");
const formatDur = (s) => { s = Number(s) || 0; const m = Math.floor(s / 60); const r = s % 60; return m ? `${m}m ${r}s` : `${r}s`; };
const FAIL_REASONS = {
  "63016": "Outside the 24-hour WhatsApp window — reconnect with an approved template message.",
  "63024": "Not a valid WhatsApp recipient (number isn't on WhatsApp or hasn't opted in).",
  "63003": "WhatsApp couldn't reach this recipient.",
  "63015": "This recipient hasn't opted in to WhatsApp messages.",
  "21408": "SMS isn't enabled for this number's region — enable it in Twilio Geo Permissions.",
  "21211": "Invalid phone number.",
  "21614": "Not an SMS-capable (mobile) number.",
  "21610": "This recipient has unsubscribed from your messages.",
};
const failReason = (code, msg) => FAIL_REASONS[String(code || "")] || msg || (code ? `Delivery failed (error ${code}).` : "Delivery failed.");
const fillTemplate = (body, vars = {}) => String(body || "").replace(/\{\{(\d+)\}\}/g, (_, n) => (vars[n] ? String(vars[n]) : `{{${n}}}`));
function dayLabel(iso) { const d = new Date(iso), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1); if (d.toDateString() === t.toDateString()) return "Today"; if (d.toDateString() === y.toDateString()) return "Yesterday"; return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); }
// Linkify a message body, rendering product links as CTA buttons.
function renderBody(body) {
  const text = String(body || "");
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      if (part.includes("/products/")) {
        return <a key={i} className="pa-cta" href={part} target="_blank" rel="noreferrer">View product ↗</a>;
      }
      return <a key={i} href={part} target="_blank" rel="noreferrer">{part}</a>;
    }
    return <span key={i}>{part}</span>;
  });
}

export default function InboxPage({ target } = {}) {
  const [threads, setThreads] = useState([]);
  const [stats, setStats] = useState({});
  const [selectedId, setSelectedId] = useState(target?.threadId || null);
  const [detail, setDetail] = useState(null);
  const [contact, setContact] = useState(null);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState(null);
  const [folder, setFolder] = useState("all");
  const [composer, setComposer] = useState("");
  const [channel, setChannel] = useState("sms");
  const [sending, setSending] = useState(false);
  const [calling, setCalling] = useState(false);
  // Contact panel visibility on narrow screens, where it renders as a slide-in
  // drawer instead of a fixed third column. Ignored (always visible) on desktop.
  const [contactOpen, setContactOpen] = useState(false);
  // Transcripts render expanded by default; this tracks the ones the user collapsed.
  const [closedTx, setClosedTx] = useState(() => new Set());
  const [error, setError] = useState(null);
  const toggleTx = (id) => setClosedTx((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [banner, setBanner] = useState(null);
  const [canned, setCanned] = useState([]);
  const [cannedOpen, setCannedOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [tplModal, setTplModal] = useState(null); // { stage:"pick"|"fill", template, vars }
  const [consentBusy, setConsentBusy] = useState({});
  const [consentRowError, setConsentRowError] = useState({});
  const [editingContact, setEditingContact] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [newMsg, setNewMsg] = useState(null); // {to, channel, body, contact?, cold?}
  const scrollRef = useRef(null);
  const channelInitFor = useRef(null);
  // Mirrors selectedId so in-flight thread/contact fetches can detect that the
  // user navigated away (mobile Back or a new selection) and drop their result
  // instead of writing stale state.
  const selectedIdRef = useRef(null);
  // A channel explicitly requested by another page (e.g. the Orders page's WhatsApp
  // button). loadThread otherwise auto-picks the channel, which would overwrite it.
  const pendingChannel = useRef(null);

  const loadThreads = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (search) p.set("q", search);
      if (folder) p.set("folder", folder);
      if (channelFilter) p.set("channel", channelFilter);
      const data = await dashboardFetch(`/api/comms/threads?${p}`);
      setThreads(data.items || []);
    } catch (err) { setError(err.message); }
  }, [search, folder, channelFilter]);

  const loadStats = useCallback(async () => {
    try { setStats(await dashboardFetch("/api/comms/stats")); } catch { /* non-critical */ }
  }, []);

  const loadThread = useCallback(async (id) => {
    if (!id) return;
    try {
      const data = await dashboardFetch(`/api/comms/thread?id=${encodeURIComponent(id)}`);
      if (selectedIdRef.current !== id) return; // superseded — user navigated away
      setDetail(data);
      // Default the composer to the channel the customer actually uses (the last
      // SMS/WhatsApp message), not last_channel (which can be chat/voice).
      // An explicitly requested channel wins — it's a deliberate user choice.
      if (channelInitFor.current !== id) {
        channelInitFor.current = id;
        const requested = pendingChannel.current;
        pendingChannel.current = null;
        if (requested) {
          setChannel(requested);
        } else {
          const msgs = data.messages || [];
          const lastSendable = [...msgs].reverse().find((m) => m.channel === "sms" || m.channel === "whatsapp");
          setChannel(lastSendable ? lastSendable.channel : "sms");
        }
      }
    } catch (err) { setError(err.message); }
  }, []);

  const loadContact = useCallback(async (id) => {
    if (!id) return;
    setContact(null); setEditingContact(false);
    try {
      const data = await dashboardFetch(`/api/comms/contact?id=${encodeURIComponent(id)}`);
      if (selectedIdRef.current !== id) return; // superseded — user navigated away
      setContact(data);
      setNotesDraft(data.contact?.notes || "");
    } catch { /* best effort */ }
  }, []);

  // Apply a target handed over by another page (Orders/Contacts). Keyed on `token`
  // rather than the id so re-opening the SAME thread still re-selects it.
  useEffect(() => {
    if (!target?.token) return;
    if (target.threadId) {
      if (target.channel && SENDABLE.some((o) => o.value === target.channel)) {
        pendingChannel.current = target.channel;
        channelInitFor.current = null; // force loadThread to re-init the channel
      }
      setSelectedId(target.threadId);
      setDetail(null);
      setThreads((p) => p.map((t) => (t.id === target.threadId ? { ...t, unread_count: 0 } : t)));
    } else if (target.compose?.to) {
      // No conversation exists yet — open the composer. The contact and thread are
      // created server-side by /api/comms/send only once this is actually sent, and
      // `contact` names it so it isn't created as a bare phone number.
      setNewMsg({
        to: target.compose.to,
        channel: SENDABLE.some((o) => o.value === target.channel) ? target.channel : "sms",
        body: "",
        contact: target.compose.contact || null,
        cold: true, // resolve-thread found no conversation → WhatsApp needs a template
      });
    }
  }, [target?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadThreads(); const t = setInterval(loadThreads, THREADS_POLL_MS); return () => clearInterval(t); }, [loadThreads]);
  useEffect(() => { loadStats(); const t = setInterval(loadStats, THREADS_POLL_MS); return () => clearInterval(t); }, [loadStats]);
  useEffect(() => { dashboardFetch("/api/comms/canned").then((d) => setCanned(d.items || [])).catch(() => {}); }, []);
  useEffect(() => { dashboardFetch("/api/comms/wa-templates").then((d) => setTemplates(d.items || [])).catch(() => {}); }, []);
  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (!selectedId) return;
    loadThread(selectedId); loadContact(selectedId);
    const t = setInterval(() => loadThread(selectedId), THREAD_POLL_MS);
    return () => clearInterval(t);
  }, [selectedId, loadThread, loadContact]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [detail?.messages?.length, selectedId]);

  const handleSelect = (id) => { setSelectedId(id); setDetail(null); setContactOpen(false); setThreads((p) => p.map((t) => (t.id === id ? { ...t, unread_count: 0 } : t))); };

  // Mobile back: return to the conversation list (single-pane navigation).
  const handleBack = () => { setSelectedId(null); setDetail(null); setContactOpen(false); };

  const patchDetailThread = (patch) => setDetail((p) => (p ? { ...p, thread: { ...p.thread, ...patch } } : p));

  const threadUpdate = async (fields) => {
    if (!detail?.thread?.id) return;
    setError(null);
    try {
      const data = await dashboardFetch("/api/comms/thread-update", { method: "POST", body: JSON.stringify({ threadId: detail.thread.id, ...fields }) });
      if (data.thread) patchDetailThread(data.thread);
      loadThreads(); loadStats();
    } catch (err) { setError(err.message); }
  };

  const handleSend = async () => {
    if (!composer.trim() || !detail?.thread?.id) return;
    // Guard here too, not just on the button: Enter calls this directly.
    if (channel === "whatsapp" && waWindowClosed) return;
    setSending(true); setError(null);
    try {
      await dashboardFetch("/api/comms/send", { method: "POST", body: JSON.stringify({ threadId: detail.thread.id, channel, body: composer.trim() }) });
      setComposer(""); await loadThread(detail.thread.id); loadThreads();
    } catch (err) { setError(err.message); } finally { setSending(false); }
  };

  const handleControl = async (mode) => {
    if (!detail?.thread?.id) return;
    setError(null);
    try {
      const data = await dashboardFetch("/api/comms/control", { method: "POST", body: JSON.stringify({ threadId: detail.thread.id, control_mode: mode }) });
      patchDetailThread({ control_mode: data.thread.control_mode }); loadThreads();
    } catch (err) { setError(err.message); }
  };

  const handleCall = async () => {
    if (!detail?.thread?.id) return;
    if (!window.confirm("Place an outbound recorded AI call to this customer now?")) return;
    setCalling(true); setError(null);
    try { await dashboardFetch("/api/comms/call", { method: "POST", body: JSON.stringify({ threadId: detail.thread.id }) }); await loadThread(detail.thread.id); }
    catch (err) { setError(err.message); } finally { setCalling(false); }
  };

  const saveContact = async (patch, note) => {
    if (!detail?.thread?.id) return;
    setError(null);
    try {
      const data = await dashboardFetch("/api/comms/contact-update", { method: "POST", body: JSON.stringify({ threadId: detail.thread.id, ...patch }) });
      await loadContact(detail.thread.id); loadThreads();
      if (data.shopifyError) setBanner(`Saved locally. Shopify sync issue: ${data.shopifyError}`);
      else if (data.shopifySynced) setBanner(note || "Saved and synced to Shopify.");
      else setBanner(note || "Saved.");
      setTimeout(() => setBanner(null), 4000);
    } catch (err) { setError(err.message); }
  };

  const addTag = () => {
    const t = tagInput.trim(); if (!t) return;
    const current = contact?.shopify?.tags || contact?.contact?.tags || [];
    if (!current.includes(t)) saveContact({ tags: [...current, t] }, "Tag added.");
    setTagInput("");
  };
  const removeTag = (tag) => {
    const current = contact?.shopify?.tags || contact?.contact?.tags || [];
    saveContact({ tags: current.filter((x) => x !== tag) }, "Tag removed.");
  };

  const handleConsent = async (channel, status) => {
    if (!detail?.thread?.id) return;
    setConsentBusy((p) => ({ ...p, [channel]: true }));
    setConsentRowError((p) => ({ ...p, [channel]: null }));
    try {
      const data = await dashboardFetch("/api/comms/consent", {
        method: "POST",
        body: JSON.stringify({ threadId: detail.thread.id, channel, status }),
      });
      await loadContact(detail.thread.id);
      setBanner(data.shopifySynced ? "Consent saved and synced to Shopify." : "Consent saved.");
      setTimeout(() => setBanner(null), 3000);
    } catch (err) {
      setConsentRowError((p) => ({ ...p, [channel]: err.message || "Save failed." }));
    } finally {
      setConsentBusy((p) => ({ ...p, [channel]: false }));
    }
  };

  const addLabel = () => {
    const l = window.prompt("Label name"); if (!l || !l.trim()) return;
    const cur = detail?.thread?.labels || [];
    if (!cur.includes(l.trim())) threadUpdate({ labels: [...cur, l.trim()] });
  };
  const removeLabel = (label) => { const cur = detail?.thread?.labels || []; threadUpdate({ labels: cur.filter((x) => x !== label) }); };

  /** Locate the thread that a `to` send just created, so we can open it. */
  const findThreadByPhone = async (phone) => {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) return null;
    const data = await dashboardFetch(`/api/comms/threads?q=${encodeURIComponent(digits.slice(-9))}`);
    return (data.items || [])[0]?.id || null;
  };

  const sendNewMessage = async () => {
    if (!newMsg?.to?.trim() || !newMsg?.body?.trim()) return;
    setError(null);
    try {
      await dashboardFetch("/api/comms/send", {
        method: "POST",
        body: JSON.stringify({ to: newMsg.to.trim(), channel: newMsg.channel, body: newMsg.body.trim(), contact: newMsg.contact || null }),
      });
      const to = newMsg.to;
      setNewMsg(null);
      await loadThreads(); loadStats();
      const found = await findThreadByPhone(to);
      if (found) handleSelect(found);
    } catch (err) { setError(err.message); }
  };

  const onComposerKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  // The 24h window is opened by an INBOUND WhatsApp message. No inbound WhatsApp ever
  // (e.g. an SMS-only thread) means it was never open — so it's closed, and only an
  // approved template will deliver. Previously this returned false in that case,
  // reporting the window as open and letting a guaranteed-to-fail free-form send through.
  const waWindowClosed = useMemo(() => {
    const msgs = detail?.messages || [];
    const lastIn = [...msgs].reverse().find((m) => m.direction === "inbound" && m.channel === "whatsapp");
    if (!lastIn) return true;
    return Date.now() - new Date(lastIn.sent_at).getTime() > 24 * 3600 * 1000;
  }, [detail]);

  const pickTemplate = (t) => {
    const name = detail?.thread?.contact?.name || tplModal?.contact?.name;
    const vars = {};
    (t.variables || []).forEach((v) => { vars[v.index] = v.index === "1" && name ? String(name).split(/\s+/)[0] : ""; });
    // Functional update: preserves `to`/`contact` on a cold-start template send.
    setTplModal((m) => ({ ...m, stage: "fill", template: t, vars }));
  };

  /**
   * Send an approved template. Two modes: against an open thread, or "cold" — to a
   * number with no conversation yet (tplModal.to), which is the ONLY way WhatsApp
   * permits opening a conversation. The backend already supports both.
   */
  const sendTemplate = async () => {
    // An explicit `to` ALWAYS wins. Falling back to the selected thread here would
    // send the template to whoever is open in the inbox instead of the number the
    // composer is addressing — i.e. to the wrong customer.
    const coldTo = tplModal?.to || null;
    const threadId = coldTo ? null : detail?.thread?.id;
    if (!tplModal?.template || (!threadId && !coldTo)) return;
    setSending(true); setError(null);
    try {
      const payload = { channel: "whatsapp", template: { sid: tplModal.template.sid, variables: tplModal.vars } };
      if (threadId) payload.threadId = threadId;
      else { payload.to = coldTo; payload.contact = tplModal.contact || null; }
      await dashboardFetch("/api/comms/send", { method: "POST", body: JSON.stringify(payload) });
      setTplModal(null);
      if (threadId) {
        await loadThread(threadId); loadThreads();
      } else {
        setNewMsg(null);
        await loadThreads(); loadStats();
        const found = await findThreadByPhone(coldTo);
        if (found) handleSelect(found);
      }
    } catch (err) { setError(err.message); } finally { setSending(false); }
  };

  const thread = detail?.thread;
  const c = thread?.contact;
  const isHuman = thread?.control_mode && thread.control_mode !== "ai";
  const tags = contact?.shopify?.tags || contact?.contact?.tags || [];

  const channelCounts = stats.channels || {};

  return (
    <div className={`pa-inbox${selectedId ? " has-thread" : ""}${contactOpen ? " contact-open" : ""}`}>
      <div className="pa-topbar">
        <div className="pa-chan-tabs">
          <button className={`pa-chan-tab ${!channelFilter ? "is-active" : ""}`} onClick={() => setChannelFilter(null)}>All</button>
          {Object.entries(CHANNELS).map(([key, cfg]) => (
            <button key={key} className={`pa-chan-tab ${channelFilter === key ? "is-active" : ""}`} onClick={() => setChannelFilter(channelFilter === key ? null : key)}>
              <span className="pa-dot" style={{ background: cfg.color }} />{cfg.label}
              {channelCounts[key] > 0 && <span className="pa-tab-count">{channelCounts[key]}</span>}
            </button>
          ))}
        </div>
        <input className="pa-search" placeholder="Search name, phone, message…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {(error || banner) && (
        <div style={{ padding: "8px 14px", background: error ? "#fdecea" : "#e7f6ec", color: error ? "#b42318" : "#1a7f43", fontSize: 13, cursor: "pointer" }} onClick={() => { setError(null); setBanner(null); }}>
          {error || banner} — dismiss
        </div>
      )}

      <div className="pa-body">
        {/* List */}
        <div className="pa-col-list">
          <div className="pa-list-head">
            <select className="pa-folder-select" value={folder} onChange={(e) => setFolder(e.target.value)}>
              {FOLDERS.map((f) => {
                const n = f.value === "unread" ? stats.unread : f.value === "starred" ? stats.starred : f.value === "pinned" ? stats.pinned : f.value === "mine" ? stats.mine : f.value === "unassigned" ? stats.unassigned : (stats.status && stats.status[f.value]);
                return <option key={f.value} value={f.value}>{f.label}{n ? ` (${n})` : ""}</option>;
              })}
            </select>
            <button className="pa-newmsg" title="New message" onClick={() => setNewMsg({ to: "", channel: "sms", body: "" })}>+</button>
          </div>
          <div className="pa-conv-scroll">
            {threads.length === 0 && (
              <div className="pa-empty" style={{ minHeight: 160 }}><div className="pa-empty-title">No conversations</div><div className="pa-muted">Messages appear here as customers reach out.</div></div>
            )}
            {threads.map((t) => {
              const nm = contactName(t.contact); const ch = CHANNELS[t.last_channel] || {};
              return (
                <div key={t.id} className={`pa-conv ${t.id === selectedId ? "is-active" : ""}`} onClick={() => handleSelect(t.id)}>
                  <div className="pa-avatar" style={{ background: avatarColor(t.contact?.phone || nm) }}>
                    {initials(t.contact?.name, t.contact?.phone)}
                    {ch.color && <span className="pa-ch-badge" style={{ background: ch.color }} />}
                  </div>
                  <div className="pa-conv-main">
                    <div className="pa-conv-top">
                      <span className="pa-conv-name">{t.pinned ? "📌 " : ""}{nm}</span>
                      <span className="pa-conv-time">{timeAgo(t.last_message_at)}</span>
                    </div>
                    <div className="pa-conv-sub">
                      <span className="pa-conv-preview">{t.last_message_preview || "—"}</span>
                      <span className="pa-conv-flags">
                        {t.starred && <span className="pa-star is-on">★</span>}
                        {t.control_mode && t.control_mode !== "ai" && <span className="pa-ch-label" style={{ background: "#fff4e5", color: "#b25c00" }}>Human</span>}
                        {t.unread_count > 0 && <span className="pa-unread">{t.unread_count}</span>}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Thread */}
        <div className="pa-col-thread">
          {!thread ? (
            <div className="pa-empty"><div className="pa-empty-title">Select a conversation</div><div className="pa-muted">Pick a customer on the left to see the full history.</div></div>
          ) : (
            <>
              <div className="pa-thread-header">
                <button className="pa-back-btn" aria-label="Back to conversations" onClick={handleBack}>←</button>
                <div className="pa-th-id">
                  <div className="pa-avatar" style={{ background: avatarColor(c?.phone || contactName(c)) }}>{initials(c?.name, c?.phone)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="pa-th-name">{contactName(c)}</div>
                    <div className="pa-th-sub">{c?.phone || ""}{c?.email ? ` · ${c.email}` : ""}</div>
                  </div>
                </div>
                <div className="pa-th-actions">
                  <select className="pa-select" value={thread.status || "open"} onChange={(e) => threadUpdate({ status: e.target.value })}>
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <button className={`pa-icon-btn ${thread.starred ? "is-on" : ""}`} title="Star" onClick={() => threadUpdate({ starred: !thread.starred })}>★</button>
                  <button className={`pa-icon-btn ${thread.pinned ? "is-on" : ""}`} title="Pin" onClick={() => threadUpdate({ pinned: !thread.pinned })}>📌</button>
                  <button className="pa-icon-btn" title="Assign to me / unassign" onClick={() => threadUpdate({ assign: thread.assigned_to ? "none" : "me" })}>{thread.assigned_to ? "👤" : "○"}</button>
                  <button className="pa-icon-btn pa-info-toggle" title="Customer details" onClick={() => setContactOpen((v) => !v)}>ⓘ</button>
                  <span className={`pa-status-pill ${isHuman ? "pa-status-human" : "pa-status-ai"}`}>{isHuman ? "Human" : "AI"}</span>
                  {c?.phone && <button className="pa-btn" disabled={calling} onClick={handleCall}>{calling ? "Calling…" : "Call"}</button>}
                  {isHuman ? <button className="pa-btn" onClick={() => handleControl("ai")}>Hand to AI</button> : <button className="pa-btn pa-btn-danger" onClick={() => handleControl("human")}>Take over</button>}
                </div>
              </div>

              <div className="pa-labels">
                {(thread.labels || []).map((l) => <span key={l} className="pa-label-chip">{l}<button onClick={() => removeLabel(l)}>×</button></span>)}
                <button className="pa-label-add" onClick={addLabel}>+ Label</button>
              </div>

              <div className="pa-messages" ref={scrollRef}>
                {(detail?.messages || []).map((m, i) => {
                  const out = m.direction === "outbound";
                  const prev = detail.messages[i - 1];
                  const showDay = !prev || new Date(prev.sent_at).toDateString() !== new Date(m.sent_at).toDateString();
                  const author = m.author === "ai" ? "AI" : m.author === "human" ? "You" : m.author === "system" ? "System" : "Customer";
                  const read = m.status === "read";
                  if (m.channel === "voice") {
                    const meta = m.metadata || {};
                    const turns = meta.transcript || [];
                    const open = !closedTx.has(m.id);
                    return (
                      <React.Fragment key={m.id || i}>
                        {showDay && <div className="pa-day">{dayLabel(m.sent_at)}</div>}
                        <div className="pa-call-card">
                          <div className="pa-call-head">
                            <span className="pa-call-ic">📞</span>
                            <span className="pa-call-title">{m.direction === "outbound" ? "Outbound" : "Inbound"} voice call{meta.duration_seconds ? ` · ${formatDur(meta.duration_seconds)}` : ""}</span>
                            <span className="pa-call-time">{clockTime(m.sent_at)}</span>
                          </div>
                          {turns.length > 0 && (
                            <>
                              <button className="pa-call-toggle" onClick={() => toggleTx(m.id)}>{open ? "Hide" : "Show"} transcript ({turns.length})</button>
                              {open && (
                                <div className="pa-transcript">
                                  {turns.map((t, ti) => (
                                    <div key={ti} className={`pa-turn ${t.role === "agent" ? "is-agent" : "is-user"}`}>
                                      <span className="pa-turn-role">{t.role === "agent" ? "AI" : "Customer"}</span>
                                      <span className="pa-turn-text">{t.message}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                          {m.body && (
                            <div className={`pa-call-summary${turns.length > 0 ? " has-label" : ""}`}>
                              {turns.length > 0 && <div className="pa-call-summary-label">Summary</div>}
                              {m.body}
                            </div>
                          )}
                        </div>
                      </React.Fragment>
                    );
                  }
                  return (
                    <React.Fragment key={m.id || i}>
                      {showDay && <div className="pa-day">{dayLabel(m.sent_at)}</div>}
                      <div className={`pa-msg-row ${out ? "is-out" : ""} ${m.author === "system" ? "is-system" : ""}`}>
                        <div>
                          <div className="pa-bubble">{m.body ? renderBody(m.body) : m.media ? "[media]" : "—"}</div>
                          <div className="pa-msg-meta">
                            {author} · {CHANNELS[m.channel]?.label || m.channel} · {clockTime(m.sent_at)}
                            {out && m.status && <span className={`pa-tick ${read ? "is-read" : ""}`}>{m.status === "failed" ? " · failed" : ["delivered", "read"].includes(m.status) ? " ✓✓" : " ✓"}</span>}
                          </div>
                          {out && m.status === "failed" && (
                            <div className="pa-fail-reason">⚠ {failReason(m.error_code, m.error_message)}</div>
                          )}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                {detail?.messages?.length === 0 && <div className="pa-muted" style={{ textAlign: "center", marginTop: 30 }}>No messages yet.</div>}
              </div>

              <div className="pa-composer">
                {channel === "whatsapp" && waWindowClosed && (
                  <div className="pa-wa-banner">
                    ⏳ 24-hour WhatsApp window is closed — a free-form message won't deliver.
                    <button onClick={() => setTplModal({ stage: "pick" })}>Use a template</button>
                  </div>
                )}
                <div className="pa-composer-tools">
                  <button className="pa-tool-btn" onClick={() => setCannedOpen((v) => !v)}>⚡ Quick replies</button>
                  <button className="pa-tool-btn" onClick={() => setTplModal({ stage: "pick" })}>🧩 Template</button>
                  {cannedOpen && (
                    <div className="pa-popover">
                      {canned.length === 0 && <div className="pa-muted" style={{ padding: 10 }}>No quick replies yet.</div>}
                      {canned.map((q) => (
                        <button key={q.id} className="pa-canned-item" onClick={() => { setComposer((b) => (b ? b + " " : "") + q.body); setCannedOpen(false); }}>
                          <div className="pa-canned-title">{q.title}</div>
                          <div className="pa-canned-body">{q.body}</div>
                        </button>
                      ))}
                      <button className="pa-canned-item" style={{ color: "var(--pa-accent)", fontWeight: 600 }} onClick={async () => {
                        const title = window.prompt("Quick reply title"); if (!title) return;
                        const body = window.prompt("Message text"); if (!body) return;
                        try { const d = await dashboardFetch("/api/comms/canned", { method: "POST", body: JSON.stringify({ title, body }) }); setCanned((p) => [...p, d.item]); } catch (err) { setError(err.message); }
                      }}>+ New quick reply</button>
                    </div>
                  )}
                </div>
                <div className="pa-composer-row">
                  <select className="pa-chan-select" value={channel} onChange={(e) => setChannel(e.target.value)}>
                    {SENDABLE.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <textarea className="pa-input" placeholder={`Reply as a human via ${CHANNELS[channel]?.label}…`} value={composer} onChange={(e) => setComposer(e.target.value)} onKeyDown={onComposerKey} rows={1} />
                  <button
                    className="pa-btn pa-btn-primary"
                    // Free-form WhatsApp outside the 24h window fails (error 63016) —
                    // the banner above offers the template, which is the only way through.
                    disabled={sending || !composer.trim() || (channel === "whatsapp" && waWindowClosed)}
                    title={channel === "whatsapp" && waWindowClosed ? "The 24-hour WhatsApp window is closed — use an approved template" : undefined}
                    onClick={handleSend}
                  >{sending ? "Sending…" : "Send"}</button>
                </div>
                <div className="pa-composer-hint">
                  {isHuman
                    ? "You're handling this conversation — the AI is paused and auto-returns after 30 min with no reply. Use “Hand to AI” to give it back now."
                    : "The AI is answering this thread. Sending a reply takes over automatically and pauses the AI."}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Contact panel — fixed third column on desktop, slide-in drawer below 1120px */}
        {thread && contactOpen && <div className="pa-drawer-overlay" onClick={() => setContactOpen(false)} />}
        {thread && (
          <div className="pa-col-contact">
            <button className="pa-drawer-close" aria-label="Close customer details" onClick={() => setContactOpen(false)}>×</button>
            <div className="pa-c-head">
              <div className="pa-c-avatar" style={{ background: avatarColor(c?.phone || contactName(c)) }}>{initials(c?.name, c?.phone)}</div>
              {editingContact ? (
                <>
                  <input className="pa-c-input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" />
                  <input className="pa-c-input" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email" />
                  <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                    <button className="pa-btn pa-btn-primary" onClick={() => { saveContact({ name: editName, email: editEmail }, "Contact saved."); setEditingContact(false); }}>Save</button>
                    <button className="pa-btn" onClick={() => setEditingContact(false)}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="pa-c-name">{contact?.shopify?.name || contactName(c)}</div>
                  <span className={`pa-c-badge ${contact?.shopify ? "is-customer" : "is-lead"}`}>{contact?.shopify ? "Shopify customer" : "Lead"}</span>
                  <div><button className="pa-link-btn" onClick={() => { setEditName(c?.name || contact?.shopify?.name || ""); setEditEmail(c?.email || contact?.shopify?.email || ""); setEditingContact(true); }}>Edit</button></div>
                </>
              )}
            </div>

            <div className="pa-section">
              <div className="pa-section-title">Contact</div>
              {c?.phone && <div className="pa-field"><span className="pa-field-ic">☎</span>{c.phone}</div>}
              {(contact?.shopify?.email || c?.email) && <div className="pa-field"><span className="pa-field-ic">✉</span>{contact?.shopify?.email || c.email}</div>}
              {contact?.stats?.channels?.length > 0 && <div className="pa-field"><span className="pa-field-ic">◍</span><span>{contact.stats.channels.map((x) => CHANNELS[x]?.label || x).join(", ")}</span></div>}
            </div>

            <div className="pa-section">
              <div className="pa-section-title">Tags{contact?.shopify ? " (synced to Shopify)" : ""}</div>
              <div className="pa-tags">
                {tags.map((t) => <span key={t} className="pa-tag">{t}<button className="pa-tag-x" onClick={() => removeTag(t)}>×</button></span>)}
                <input className="pa-tag-input" placeholder="+ tag" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTag(); }} />
              </div>
            </div>

            <div className="pa-section">
              <div
                className="pa-section-title"
                title="Records that the customer told you (by phone, chat, or a reply) whether they want marketing on this channel. It doesn't change what you can send today — templates work regardless — it's the record future campaigns will use, and it protects your WhatsApp number's standing with Meta."
              >
                Marketing consent ⓘ
              </div>
              {[["email", "Email"], ["sms", "SMS"], ["whatsapp", "WhatsApp"], ["calls", "Calls"]].map(([ch, label]) => {
                const st = contact?.consent?.[ch] || "unknown";
                const on = st === "subscribed";
                const busy = !!consentBusy[ch];
                const rowErr = consentRowError[ch];
                return (
                  <div key={ch}>
                    <div className="pa-consent-row">
                      <span style={{ flex: 1 }}>{label}</span>
                      <span className={`pa-consent-pill ${on ? "on" : st === "unsubscribed" ? "off" : "unk"}`}>
                        {on ? "Subscribed" : st === "unsubscribed" ? "Unsubscribed" : st === "not_subscribed" ? "Not subscribed" : "Unknown"}
                      </span>
                      <button className="pa-consent-btn" disabled={busy} onClick={() => handleConsent(ch, on ? "unsubscribed" : "subscribed")}>
                        {busy ? "Saving…" : on ? "Opt out" : "Opt in"}
                      </button>
                    </div>
                    {rowErr && <div className="pa-fail-reason" style={{ marginTop: -3, marginBottom: 6 }}>⚠ {rowErr}</div>}
                  </div>
                );
              })}
              <div className="pa-muted" style={{ fontSize: 11, marginTop: 5 }}>
                Manual record of consent the customer gave you directly — not a technical send permission.
                {contact?.consent?.linkedToShopify && " Email & SMS sync to the Shopify customer."}
              </div>
            </div>

            <div className="pa-section">
              <div className="pa-section-head"><div className="pa-section-title" style={{ margin: 0 }}>Notes</div></div>
              <textarea className="pa-c-notes" value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder="Internal note (synced to the Shopify customer note)…" />
              <div style={{ marginTop: 6 }}><button className="pa-btn pa-btn-primary" onClick={() => saveContact({ notes: notesDraft }, "Note saved.")}>Save note</button></div>
            </div>

            <div className="pa-section">
              <div className="pa-section-head">
                <div className="pa-section-title" style={{ margin: 0 }}>Recent orders</div>
                {contact?.shopify?.customer_id && <a className="pa-link-btn" href={`${ADMIN_BASE}/customers/${contact.shopify.customer_id}`} target="_blank" rel="noreferrer">View all</a>}
              </div>
              {contact?.shopify?.orders?.length > 0 ? contact.shopify.orders.map((o) => {
                const tone = statusTone(o.financial_status, o.fulfillment_status);
                return (
                  <a key={o.name} className="pa-order pa-order-link" href={o.id ? `${ADMIN_BASE}/orders/${o.id}` : undefined} target="_blank" rel="noreferrer">
                    <div className="pa-order-top"><span className="pa-order-name">{o.name}</span><span className="pa-order-badge" style={{ background: tone.bg, color: tone.color }}>{tone.label}</span></div>
                    <div className="pa-order-meta">{money(o.total_price, o.currency)} · {dateShort(o.created_at)}</div>
                    {o.items?.length > 0 && <div className="pa-order-items">{o.items.join(", ")}</div>}
                  </a>
                );
              }) : <div className="pa-muted">{contact?.shopify ? "No recent orders." : "Not linked to a Shopify customer."}</div>}
            </div>

            {contact?.browsing?.events?.length > 0 && (
              <div className="pa-section">
                <div className="pa-section-head">
                  <div className="pa-section-title" style={{ margin: 0 }}>Browsing activity</div>
                  <span className="pa-muted" style={{ fontSize: 11 }}>
                    {contact.browsing.summary.total} view{contact.browsing.summary.total === 1 ? "" : "s"}
                    {contact.browsing.summary.products > 0 ? ` · ${contact.browsing.summary.products} product${contact.browsing.summary.products === 1 ? "" : "s"}` : ""}
                  </span>
                </div>
                {contact.browsing.events.slice(0, 8).map((e, i) => {
                  // The pixel endpoint is public, so `url` is untrusted. Only make it a live
                  // link when it's genuinely http(s); anything else renders as plain text so a
                  // hostile `javascript:`/`data:` URL can never become a staff-clickable link.
                  const href = safeBrowseHref(e.url);
                  return (
                    <a
                      key={i}
                      className="pa-browse-row"
                      href={href}
                      target={href ? "_blank" : undefined}
                      rel="noreferrer"
                      title={href || ""}
                    >
                      <span className="pa-browse-ic">{BROWSE_ICON[e.name] || "•"}</span>
                      <span className="pa-browse-label">{browseLabel(e)}</span>
                      <span className="pa-browse-time">{e.at ? timeAgo(e.at) : ""}</span>
                    </a>
                  );
                })}
              </div>
            )}

            <div className="pa-section" style={{ borderBottom: "none" }}>
              <div className="pa-section-title">Conversation history</div>
              <div className="pa-hist-row"><span>First contact</span><span>{dateShort(contact?.stats?.first_contact) || "—"}</span></div>
              <div className="pa-hist-row"><span>Messages</span><span>{contact?.stats?.messages_count ?? "—"}</span></div>
              <div className="pa-hist-row"><span>Last seen</span><span>{contact?.stats?.last_seen ? timeAgo(contact.stats.last_seen) + " ago" : "—"}</span></div>
              {contact?.browsing?.summary?.lastActive && (
                <div className="pa-hist-row"><span>Last browsed</span><span>{timeAgo(contact.browsing.summary.lastActive)} ago</span></div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* New message modal */}
      {newMsg && (
        <div className="pa-modal-overlay" onClick={() => setNewMsg(null)}>
          <div className="pa-modal" onClick={(e) => e.stopPropagation()}>
            <h3>New message</h3>
            <label>To (phone, E.164)</label>
            <input value={newMsg.to} onChange={(e) => setNewMsg({ ...newMsg, to: e.target.value })} placeholder="+61400000000" />
            <label>Channel</label>
            <select value={newMsg.channel} onChange={(e) => setNewMsg({ ...newMsg, channel: e.target.value })}>{SENDABLE.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            {newMsg.channel === "whatsapp" && (
              <div className="pa-wa-banner" style={{ marginTop: 10 }}>
                {newMsg.cold
                  ? "⏳ No WhatsApp conversation with this number yet. WhatsApp only allows an approved template to open one — a free-form message will not deliver."
                  : "⏳ If this number hasn't messaged you in the last 24 hours, only an approved template will deliver."}
                <button onClick={() => setTplModal({ stage: "pick", to: newMsg.to.trim(), contact: newMsg.contact || null })}>Use a template</button>
              </div>
            )}
            <label>Message</label>
            <textarea rows={3} value={newMsg.body} onChange={(e) => setNewMsg({ ...newMsg, body: e.target.value })} placeholder="Type a message…" />
            <div className="pa-modal-actions">
              <button className="pa-btn" onClick={() => setNewMsg(null)}>Cancel</button>
              <button
                className="pa-btn pa-btn-primary"
                // A cold free-form WhatsApp send is guaranteed to fail (error 63016) —
                // don't offer it; the template button above is the only way through.
                disabled={!newMsg.to.trim() || !newMsg.body.trim() || (newMsg.cold && newMsg.channel === "whatsapp")}
                title={newMsg.cold && newMsg.channel === "whatsapp" ? "Use an approved template to open a WhatsApp conversation" : undefined}
                onClick={sendNewMessage}
              >Send</button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp template picker / fill-in */}
      {tplModal && (
        <div className="pa-modal-overlay" onClick={() => setTplModal(null)}>
          <div className="pa-modal" onClick={(e) => e.stopPropagation()}>
            {tplModal.stage === "pick" ? (
              <>
                <h3>Choose a WhatsApp template</h3>
                {templates.length === 0 && <div className="pa-muted">No approved templates found.</div>}
                {["UTILITY", "MARKETING", "AUTHENTICATION"].map((cat) => {
                  const inCat = templates.filter((t) => (t.category || "UTILITY") === cat);
                  if (!inCat.length) return null;
                  return (
                    <div key={cat} style={{ marginTop: 10 }}>
                      <div className="pa-section-title">{cat === "MARKETING" ? "Marketing (needs opt-in)" : cat.charAt(0) + cat.slice(1).toLowerCase()}</div>
                      {inCat.map((t) => (
                        <button key={t.sid} className="pa-canned-item" onClick={() => pickTemplate(t)}>
                          <div className="pa-canned-title">{t.name}</div>
                          <div className="pa-canned-body">{t.body}</div>
                        </button>
                      ))}
                    </div>
                  );
                })}
                <div className="pa-modal-actions"><button className="pa-btn" onClick={() => setTplModal(null)}>Close</button></div>
              </>
            ) : (
              <>
                <h3>{tplModal.template.name}</h3>
                <div style={{ fontSize: 12, color: "var(--pa-ink-2)", marginBottom: 6 }}>
                  {tplModal.template.category === "MARKETING" ? "Marketing template — recipient should be opted in." : "Utility template."}
                </div>
                {(tplModal.template.variables || []).map((v) => (
                  <div key={v.index}>
                    <label>Variable {v.index} <span style={{ color: "#9aa0aa", fontWeight: 400 }}>(e.g. {v.example})</span></label>
                    <input value={tplModal.vars[v.index] || ""} onChange={(e) => setTplModal((m) => ({ ...m, vars: { ...m.vars, [v.index]: e.target.value } }))} />
                  </div>
                ))}
                <label>Preview</label>
                <div style={{ padding: "10px 12px", background: "var(--pa-accent-soft)", borderRadius: 9, fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                  {fillTemplate(tplModal.template.body, tplModal.vars)}
                </div>
                <div className="pa-modal-actions">
                  {/* Functional update: dropping `to`/`contact` here would silently
                      re-target a cold send at the selected thread. */}
                  <button className="pa-btn" onClick={() => setTplModal((m) => ({ ...m, stage: "pick", template: null, vars: {} }))}>Back</button>
                  <button className="pa-btn pa-btn-primary" disabled={sending} onClick={sendTemplate}>{sending ? "Sending…" : "Send template"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
