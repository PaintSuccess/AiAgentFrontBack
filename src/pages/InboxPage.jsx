import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { dashboardFetch } from "../utils/fetch";
import "./inbox.css";

const CHANNELS = {
  sms: { label: "SMS", color: "#2f7ed8" },
  whatsapp: { label: "WhatsApp", color: "#25b366" },
  chat: { label: "Chat", color: "#7a5af8" },
  voice: { label: "Voice", color: "#f59e0b" },
  email: { label: "Email", color: "#ec4899" },
};
const SENDABLE = [
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
];
const AVATAR_COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#6366f1", "#f97316"];
const THREADS_POLL_MS = 6000;
const THREAD_POLL_MS = 4000;

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) | 0;
  return Math.abs(h);
}
function avatarColor(seed) {
  return AVATAR_COLORS[hashStr(seed || "?") % AVATAR_COLORS.length];
}
function initials(name, phone) {
  const n = String(name || "").trim();
  if (n) {
    const parts = n.split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || n.slice(0, 2).toUpperCase();
  }
  const d = String(phone || "").replace(/\D/g, "");
  return d ? d.slice(-2) : "?";
}
function contactName(c) {
  if (!c) return "Unknown";
  return c.name || c.email || c.phone || "Unknown";
}
function timeAgo(iso) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
function clockTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
}
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
function money(v, cur) {
  if (v == null) return "";
  return `${cur || "AUD"} ${Number(v).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;
}
function statusTone(fin, ful) {
  if (fin === "paid") return { bg: "#e7f6ec", color: "#1a7f43", label: "Paid" };
  if (ful === "fulfilled") return { bg: "#e7f6ec", color: "#1a7f43", label: "Fulfilled" };
  if (fin === "refunded") return { bg: "#fdecea", color: "#b42318", label: "Refunded" };
  return { bg: "#fef7e6", color: "#b25c00", label: (fin || ful || "Open") };
}

export default function InboxPage() {
  const [threads, setThreads] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [contact, setContact] = useState(null);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [composer, setComposer] = useState("");
  const [channel, setChannel] = useState("sms");
  const [sending, setSending] = useState(false);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const channelInitFor = useRef(null);

  const loadThreads = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      const data = await dashboardFetch(`/api/comms/threads?${params}`);
      setThreads(data.items || []);
    } catch (err) {
      setError(err.message);
    }
  }, [search]);

  const loadThread = useCallback(async (id) => {
    if (!id) return;
    try {
      const data = await dashboardFetch(`/api/comms/thread?id=${encodeURIComponent(id)}`);
      setDetail(data);
      if (channelInitFor.current !== id) {
        channelInitFor.current = id;
        const lc = data.thread?.last_channel;
        if (lc === "whatsapp" || lc === "sms") setChannel(lc);
      }
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const loadContact = useCallback(async (id) => {
    if (!id) return;
    setContact(null);
    try {
      setContact(await dashboardFetch(`/api/comms/contact?id=${encodeURIComponent(id)}`));
    } catch {
      /* contact panel is best-effort */
    }
  }, []);

  useEffect(() => {
    loadThreads();
    const t = setInterval(loadThreads, THREADS_POLL_MS);
    return () => clearInterval(t);
  }, [loadThreads]);

  useEffect(() => {
    if (!selectedId) return;
    loadThread(selectedId);
    loadContact(selectedId);
    const t = setInterval(() => loadThread(selectedId), THREAD_POLL_MS);
    return () => clearInterval(t);
  }, [selectedId, loadThread, loadContact]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [detail?.messages?.length, selectedId]);

  const visibleThreads = useMemo(() => {
    return threads.filter((t) => {
      if (channelFilter && t.last_channel !== channelFilter) return false;
      if (unreadOnly && !(t.unread_count > 0)) return false;
      return true;
    });
  }, [threads, channelFilter, unreadOnly]);

  const handleSelect = (id) => {
    setSelectedId(id);
    setDetail(null);
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, unread_count: 0 } : t)));
  };

  const handleSend = async () => {
    if (!composer.trim() || !detail?.thread?.id) return;
    setSending(true);
    setError(null);
    try {
      await dashboardFetch("/api/comms/send", {
        method: "POST",
        body: JSON.stringify({ threadId: detail.thread.id, channel, body: composer.trim() }),
      });
      setComposer("");
      await loadThread(detail.thread.id);
      loadThreads();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleControl = async (mode) => {
    if (!detail?.thread?.id) return;
    setError(null);
    try {
      const data = await dashboardFetch("/api/comms/control", {
        method: "POST",
        body: JSON.stringify({ threadId: detail.thread.id, control_mode: mode }),
      });
      setDetail((p) => (p ? { ...p, thread: { ...p.thread, control_mode: data.thread.control_mode } } : p));
      loadThreads();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCall = async () => {
    if (!detail?.thread?.id) return;
    if (!window.confirm("Place an outbound recorded AI call to this customer now?")) return;
    setCalling(true);
    setError(null);
    try {
      await dashboardFetch("/api/comms/call", {
        method: "POST",
        body: JSON.stringify({ threadId: detail.thread.id }),
      });
      await loadThread(detail.thread.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setCalling(false);
    }
  };

  const onComposerKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const thread = detail?.thread;
  const c = thread?.contact;
  const isHuman = thread?.control_mode && thread.control_mode !== "ai";

  return (
    <div className="pa-inbox">
      {/* Top bar */}
      <div className="pa-topbar">
        <div className="pa-chan-tabs">
          <button className={`pa-chan-tab ${!channelFilter ? "is-active" : ""}`} onClick={() => setChannelFilter(null)}>All</button>
          {Object.entries(CHANNELS).map(([key, cfg]) => (
            <button
              key={key}
              className={`pa-chan-tab ${channelFilter === key ? "is-active" : ""}`}
              onClick={() => setChannelFilter(channelFilter === key ? null : key)}
            >
              <span className="pa-dot" style={{ background: cfg.color }} />
              {cfg.label}
            </button>
          ))}
        </div>
        <input
          className="pa-search"
          placeholder="Search name, phone, message…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && (
        <div style={{ padding: "8px 14px", background: "#fdecea", color: "#b42318", fontSize: 13, cursor: "pointer" }} onClick={() => setError(null)}>
          {error} — dismiss
        </div>
      )}

      <div className="pa-body">
        {/* Conversation list */}
        <div className="pa-col-list">
          <div className="pa-list-filters">
            <button className={`pa-chip ${!unreadOnly ? "is-active" : ""}`} onClick={() => setUnreadOnly(false)}>All</button>
            <button className={`pa-chip ${unreadOnly ? "is-active" : ""}`} onClick={() => setUnreadOnly(true)}>Unread</button>
          </div>
          <div className="pa-conv-scroll">
            {visibleThreads.length === 0 && (
              <div className="pa-empty" style={{ minHeight: 200 }}>
                <div className="pa-empty-title">No conversations</div>
                <div className="pa-muted">Messages appear here as customers reach out.</div>
              </div>
            )}
            {visibleThreads.map((t) => {
              const nm = contactName(t.contact);
              const ch = CHANNELS[t.last_channel] || {};
              return (
                <div key={t.id} className={`pa-conv ${t.id === selectedId ? "is-active" : ""}`} onClick={() => handleSelect(t.id)}>
                  <div className="pa-avatar" style={{ background: avatarColor(t.contact?.phone || nm) }}>
                    {initials(t.contact?.name, t.contact?.phone)}
                    {ch.color && <span className="pa-ch-badge" style={{ background: ch.color }} />}
                  </div>
                  <div className="pa-conv-main">
                    <div className="pa-conv-top">
                      <span className="pa-conv-name">{nm}</span>
                      <span className="pa-conv-time">{timeAgo(t.last_message_at)}</span>
                    </div>
                    <div className="pa-conv-sub">
                      <span className="pa-conv-preview">{t.last_message_preview || "—"}</span>
                      {t.control_mode && t.control_mode !== "ai" && (
                        <span className="pa-ch-label" style={{ background: "#fff4e5", color: "#b25c00" }}>Human</span>
                      )}
                      {t.unread_count > 0 && <span className="pa-unread">{t.unread_count}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Conversation thread */}
        <div className="pa-col-thread">
          {!thread ? (
            <div className="pa-empty">
              <div className="pa-empty-title">Select a conversation</div>
              <div className="pa-muted">Pick a customer on the left to see the full history.</div>
            </div>
          ) : (
            <>
              <div className="pa-thread-header">
                <div className="pa-th-id">
                  <div className="pa-avatar" style={{ background: avatarColor(c?.phone || contactName(c)) }}>
                    {initials(c?.name, c?.phone)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="pa-th-name">{contactName(c)}</div>
                    <div className="pa-th-sub">{c?.phone || ""}{c?.email ? ` · ${c.email}` : ""}</div>
                  </div>
                </div>
                <div className="pa-th-actions">
                  <span className={`pa-status-pill ${isHuman ? "pa-status-human" : "pa-status-ai"}`}>
                    {isHuman ? "Human control" : "AI active"}
                  </span>
                  {c?.phone && <button className="pa-btn" disabled={calling} onClick={handleCall}>{calling ? "Calling…" : "Call"}</button>}
                  {isHuman ? (
                    <button className="pa-btn" onClick={() => handleControl("ai")}>Hand to AI</button>
                  ) : (
                    <button className="pa-btn pa-btn-danger" onClick={() => handleControl("human")}>Take over</button>
                  )}
                </div>
              </div>

              <div className="pa-messages" ref={scrollRef}>
                {(detail?.messages || []).map((m, i) => {
                  const out = m.direction === "outbound";
                  const prev = detail.messages[i - 1];
                  const showDay = !prev || new Date(prev.sent_at).toDateString() !== new Date(m.sent_at).toDateString();
                  const author = m.author === "ai" ? "AI" : m.author === "human" ? "You" : m.author === "system" ? "System" : "Customer";
                  const read = m.status === "read";
                  return (
                    <React.Fragment key={m.id || i}>
                      {showDay && <div className="pa-day">{dayLabel(m.sent_at)}</div>}
                      <div className={`pa-msg-row ${out ? "is-out" : ""} ${m.author === "system" ? "is-system" : ""}`}>
                        <div>
                          <div className="pa-bubble">{m.body || (m.media ? "[media]" : "—")}</div>
                          <div className="pa-msg-meta">
                            {author} · {(CHANNELS[m.channel]?.label) || m.channel} · {clockTime(m.sent_at)}
                            {out && m.status && (
                              <span className={`pa-tick ${read ? "is-read" : ""}`}>
                                {m.status === "failed" ? " · failed" : ["delivered", "read"].includes(m.status) ? " ✓✓" : " ✓"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                {detail?.messages?.length === 0 && <div className="pa-muted" style={{ textAlign: "center", marginTop: 30 }}>No messages yet.</div>}
              </div>

              <div className="pa-composer">
                <div className="pa-composer-row">
                  <select className="pa-chan-select" value={channel} onChange={(e) => setChannel(e.target.value)}>
                    {SENDABLE.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <textarea
                    className="pa-input"
                    placeholder={`Reply as a human via ${CHANNELS[channel]?.label}…`}
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    onKeyDown={onComposerKey}
                    rows={1}
                  />
                  <button className="pa-btn pa-btn-primary" disabled={sending || !composer.trim()} onClick={handleSend}>
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
                {!isHuman && (
                  <div className="pa-composer-hint">AI is active on this thread and will keep auto-replying. Use “Take over” to pause it.</div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Contact panel */}
        {thread && (
          <div className="pa-col-contact">
            <div className="pa-c-head">
              <div className="pa-c-avatar" style={{ background: avatarColor(c?.phone || contactName(c)) }}>
                {initials(c?.name, c?.phone)}
              </div>
              <div className="pa-c-name">{contact?.shopify?.name || contactName(c)}</div>
              <span className={`pa-c-badge ${contact?.shopify ? "is-customer" : "is-lead"}`}>
                {contact?.shopify ? "Shopify customer" : "Lead"}
              </span>
            </div>

            <div className="pa-section">
              <div className="pa-section-title">Contact</div>
              {c?.phone && <div className="pa-field"><span className="pa-field-ic">☎</span>{c.phone}</div>}
              {(contact?.shopify?.email || c?.email) && <div className="pa-field"><span className="pa-field-ic">✉</span>{contact?.shopify?.email || c.email}</div>}
              {contact?.stats?.channels?.length > 0 && (
                <div className="pa-field">
                  <span className="pa-field-ic">◍</span>
                  <span>{contact.stats.channels.map((ch) => CHANNELS[ch]?.label || ch).join(", ")}</span>
                </div>
              )}
            </div>

            {contact?.shopify?.tags?.length > 0 && (
              <div className="pa-section">
                <div className="pa-section-title">Tags</div>
                <div className="pa-tags">{contact.shopify.tags.map((t) => <span key={t} className="pa-tag">{t}</span>)}</div>
              </div>
            )}

            <div className="pa-section">
              <div className="pa-section-title">Recent orders</div>
              {contact?.shopify?.orders?.length > 0 ? (
                contact.shopify.orders.map((o) => {
                  const tone = statusTone(o.financial_status, o.fulfillment_status);
                  return (
                    <div key={o.name} className="pa-order">
                      <div className="pa-order-top">
                        <span className="pa-order-name">{o.name}</span>
                        <span className="pa-order-badge" style={{ background: tone.bg, color: tone.color }}>{tone.label}</span>
                      </div>
                      <div className="pa-order-meta">{money(o.total_price, o.currency)} · {o.created_at ? new Date(o.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : ""}</div>
                      {o.items?.length > 0 && <div className="pa-order-items">{o.items.join(", ")}</div>}
                    </div>
                  );
                })
              ) : (
                <div className="pa-muted">{contact?.shopify ? "No recent orders." : "Not linked to a Shopify customer."}</div>
              )}
            </div>

            <div className="pa-section" style={{ borderBottom: "none" }}>
              <div className="pa-section-title">Conversation history</div>
              <div className="pa-hist-row"><span>First contact</span><span>{contact?.stats?.first_contact ? new Date(contact.stats.first_contact).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span></div>
              <div className="pa-hist-row"><span>Messages</span><span>{contact?.stats?.messages_count ?? "—"}</span></div>
              <div className="pa-hist-row"><span>Last seen</span><span>{contact?.stats?.last_seen ? timeAgo(contact.stats.last_seen) + " ago" : "—"}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
