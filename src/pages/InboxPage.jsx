import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Page,
  Card,
  Text,
  Badge,
  Button,
  TextField,
  Select,
  Spinner,
  Box,
  InlineStack,
  BlockStack,
  Banner,
} from "@shopify/polaris";
import { dashboardFetch } from "../utils/fetch";

const CHANNEL_TONE = { sms: "success", whatsapp: "success", email: "warning", chat: "info", voice: "attention" };
const CHANNEL_LABEL = { sms: "SMS", whatsapp: "WhatsApp", email: "Email", chat: "Chat", voice: "Voice" };
const THREADS_POLL_MS = 6000;
const THREAD_POLL_MS = 4000;

function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function contactName(c) {
  if (!c) return "Unknown";
  return c.name || c.email || c.phone || "Unknown";
}

export default function InboxPage() {
  const [threads, setThreads] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState("");
  const [channel, setChannel] = useState("sms");
  const [sending, setSending] = useState(false);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const channelInitFor = useRef(null); // thread id we've defaulted the channel for

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
      // Default the composer channel once per opened thread; never override the
      // agent's manual choice on subsequent polls.
      if (channelInitFor.current !== id) {
        channelInitFor.current = id;
        const lc = data.thread?.last_channel;
        if (lc === "whatsapp" || lc === "sms") setChannel(lc);
      }
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // Poll thread list.
  useEffect(() => {
    loadThreads();
    const t = setInterval(loadThreads, THREADS_POLL_MS);
    return () => clearInterval(t);
  }, [loadThreads]);

  // Poll the open thread.
  useEffect(() => {
    if (!selectedId) return;
    loadThread(selectedId);
    const t = setInterval(() => loadThread(selectedId), THREAD_POLL_MS);
    return () => clearInterval(t);
  }, [selectedId, loadThread]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [detail?.messages?.length, selectedId]);

  const handleSelect = (id) => {
    setSelectedId(id);
    setDetail(null);
    // optimistic unread clear
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

  const handleControl = async (mode) => {
    if (!detail?.thread?.id) return;
    setError(null);
    try {
      const data = await dashboardFetch("/api/comms/control", {
        method: "POST",
        body: JSON.stringify({ threadId: detail.thread.id, control_mode: mode }),
      });
      setDetail((prev) => (prev ? { ...prev, thread: { ...prev.thread, control_mode: data.thread.control_mode } } : prev));
    } catch (err) {
      setError(err.message);
    }
  };

  const thread = detail?.thread;
  const isHuman = thread?.control_mode && thread.control_mode !== "ai";

  return (
    <Page title="Inbox" fullWidth>
      {error && (
        <Box paddingBlockEnd="300">
          <Banner tone="critical" onDismiss={() => setError(null)}>{error}</Banner>
        </Box>
      )}
      <div style={{ display: "flex", gap: 16, height: "calc(100vh - 160px)", minHeight: 480 }}>
        {/* Thread list */}
        <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <Card padding="0">
            <Box padding="300">
              <TextField
                label="Search"
                labelHidden
                placeholder="Search name, phone, message…"
                value={search}
                onChange={setSearch}
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setSearch("")}
              />
            </Box>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {threads.length === 0 && (
                <Box padding="400"><Text as="p" tone="subdued" alignment="center">No conversations yet</Text></Box>
              )}
              {threads.map((t) => (
                <div
                  key={t.id}
                  onClick={() => handleSelect(t.id)}
                  style={{
                    padding: "12px 16px",
                    cursor: "pointer",
                    borderBottom: "1px solid var(--p-color-border-subdued)",
                    background: t.id === selectedId ? "var(--p-color-bg-surface-selected)" : "transparent",
                  }}
                >
                  <InlineStack align="space-between" blockAlign="center" gap="200">
                    <Text as="span" fontWeight="semibold" truncate>{contactName(t.contact)}</Text>
                    <Text as="span" tone="subdued" variant="bodySm">{timeAgo(t.last_message_at)}</Text>
                  </InlineStack>
                  <InlineStack gap="150" blockAlign="center">
                    {t.last_channel && <Badge tone={CHANNEL_TONE[t.last_channel]}>{CHANNEL_LABEL[t.last_channel] || t.last_channel}</Badge>}
                    {t.control_mode && t.control_mode !== "ai" && <Badge tone="attention">Human</Badge>}
                    {t.unread_count > 0 && <Badge tone="critical">{String(t.unread_count)}</Badge>}
                  </InlineStack>
                  <Text as="p" tone="subdued" variant="bodySm" truncate>{t.last_message_preview || "—"}</Text>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Conversation */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <Card padding="0">
            {!thread && (
              <Box padding="600"><Text as="p" tone="subdued" alignment="center">Select a conversation</Text></Box>
            )}
            {thread && (
              <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 176px)", minHeight: 460 }}>
                {/* Header */}
                <Box padding="300" borderBlockEndWidth="025" borderColor="border">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="h2" variant="headingMd">{contactName(thread.contact)}</Text>
                      <Text as="span" tone="subdued" variant="bodySm">
                        {thread.contact?.phone || ""}{thread.contact?.email ? ` · ${thread.contact.email}` : ""}
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={isHuman ? "attention" : "info"}>{isHuman ? "Human control" : "AI active"}</Badge>
                      {thread.contact?.phone && (
                        <Button loading={calling} onClick={handleCall}>Call</Button>
                      )}
                      {isHuman ? (
                        <Button onClick={() => handleControl("ai")}>Hand back to AI</Button>
                      ) : (
                        <Button variant="primary" tone="critical" onClick={() => handleControl("human")}>Take over</Button>
                      )}
                    </InlineStack>
                  </InlineStack>
                </Box>

                {/* Messages */}
                <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 16, background: "var(--p-color-bg-surface-secondary)" }}>
                  {!detail?.messages && <InlineStack align="center"><Spinner size="small" /></InlineStack>}
                  {(detail?.messages || []).map((m) => {
                    const out = m.direction === "outbound";
                    return (
                      <div key={m.id} style={{ display: "flex", justifyContent: out ? "flex-end" : "flex-start", marginBottom: 10 }}>
                        <div style={{ maxWidth: "72%" }}>
                          <div style={{
                            background: out ? "var(--p-color-bg-fill-brand)" : "var(--p-color-bg-surface)",
                            color: out ? "var(--p-color-text-brand-on-bg-fill)" : "inherit",
                            border: out ? "none" : "1px solid var(--p-color-border)",
                            borderRadius: 12, padding: "8px 12px", whiteSpace: "pre-wrap", wordBreak: "break-word",
                          }}>
                            {m.body || (m.media ? "[media]" : "—")}
                          </div>
                          <div style={{ textAlign: out ? "right" : "left", marginTop: 2 }}>
                            <Text as="span" tone="subdued" variant="bodySm">
                              {(m.author === "ai" ? "AI" : m.author === "human" ? "You" : m.author === "system" ? "System" : "Customer")}
                              {" · "}{CHANNEL_LABEL[m.channel] || m.channel}
                              {m.status ? ` · ${m.status}` : ""}
                              {" · "}{timeAgo(m.sent_at)}
                            </Text>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Composer */}
                <Box padding="300" borderBlockStartWidth="025" borderColor="border">
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="end">
                      <div style={{ width: 140 }}>
                        <Select
                          label="Channel"
                          labelHidden
                          options={[{ label: "SMS", value: "sms" }, { label: "WhatsApp", value: "whatsapp" }]}
                          value={channel}
                          onChange={setChannel}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Message"
                          labelHidden
                          placeholder={`Reply as a human via ${CHANNEL_LABEL[channel]}…`}
                          value={composer}
                          onChange={setComposer}
                          multiline={2}
                          autoComplete="off"
                        />
                      </div>
                      <Button variant="primary" loading={sending} disabled={!composer.trim()} onClick={handleSend}>Send</Button>
                    </InlineStack>
                    {!isHuman && (
                      <Text as="p" tone="subdued" variant="bodySm">
                        AI is still active on this thread — it will keep auto-replying. Use “Take over” to pause it.
                      </Text>
                    )}
                  </BlockStack>
                </Box>
              </div>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
