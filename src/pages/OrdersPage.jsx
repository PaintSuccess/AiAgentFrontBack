import React, { useState, useEffect, useCallback, useRef } from "react";
import { dashboardFetch } from "../utils/fetch";
import { ADMIN_BASE, gidToId, dateShort, statusTone, formatOpsMoney } from "../utils/shopify";
import "./inbox.css";

const itemSummary = (lineItems = []) =>
  lineItems
    .slice(0, 3)
    .map((li) => `${li.title}${li.quantity ? ` ×${li.quantity}` : ""}`)
    .join(", ") + (lineItems.length > 3 ? ` +${lineItems.length - 3} more` : "");

export default function OrdersPage({ onOpenInbox }) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // Guards against out-of-order responses: a slow request must never overwrite (or
  // append to) results from a newer search. Bumped on every fresh load.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      const d = await dashboardFetch(`/api/comms/orders?${p}`);
      if (mine !== seq.current) return; // superseded by a newer search
      setItems(d.items || []);
      setCursor(d.page_info?.end_cursor || null);
      setHasMore(Boolean(d.page_info?.has_next_page));
    } catch (err) {
      if (mine !== seq.current) return;
      setError(err.message);
      setItems([]);
      setHasMore(false);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [q]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const loadMore = async () => {
    if (!cursor) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      p.set("cursor", cursor);
      const d = await dashboardFetch(`/api/comms/orders?${p}`);
      // The search changed while this page was in flight — appending now would mix
      // the old query's results into the new list.
      if (mine !== seq.current) return;
      setItems((prev) => [...prev, ...(d.items || [])]);
      setCursor(d.page_info?.end_cursor || null);
      setHasMore(Boolean(d.page_info?.has_next_page));
    } catch (err) {
      if (mine === seq.current) setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  /**
   * Jump to this customer's conversation. Resolution is read-only: if they've never
   * messaged us there is no thread yet, so we hand the Comms Hub a pre-filled
   * composer instead — the contact/thread is created only on an actual send.
   */
  const openFor = async (order, channel) => {
    const { customer_phone: phone, customer_email: email } = order;
    if (!phone && !email) return;
    setBusyId(order.id);
    setError(null);
    setNotice(null);
    try {
      const p = new URLSearchParams();
      if (phone) p.set("phone", phone);
      if (email) p.set("email", email);
      const d = await dashboardFetch(`/api/comms/resolve-thread?${p}`);
      if (d.threadId) {
        onOpenInbox({ threadId: d.threadId, channel });
        return;
      }
      // No conversation yet.
      if (channel === "email") {
        setNotice(`No conversation with ${order.customer_name || "this customer"} yet — and email can't be sent from the hub yet, only viewed.`);
        return;
      }
      if (!phone) {
        setNotice(`${order.order_number} has an email but no phone number, so SMS/WhatsApp can't start a conversation.`);
        return;
      }
      // Carry who this is, so the contact created on send is a named Shopify customer
      // rather than a bare phone number. gidToId: the rest of the app stores the
      // NUMERIC Shopify customer id, not the GraphQL GID.
      onOpenInbox({
        compose: {
          to: phone,
          contact: {
            name: order.customer_name || null,
            email: email || null,
            shopifyCustomerId: gidToId(order.customer_id) || null,
          },
        },
        channel: channel || "sms",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const act = (e, order, channel) => { e.stopPropagation(); openFor(order, channel); };

  return (
    <div className="pa-contacts">
      <div className="pa-contacts-head">
        <h1>Orders</h1>
        <input
          className="pa-search"
          placeholder="Search order number, customer, email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {(error || notice) && (
        <div
          style={{ padding: "8px 20px", background: error ? "#fdecea" : "#fff7e6", color: error ? "#b42318" : "#b25c00", fontSize: 13, cursor: "pointer" }}
          onClick={() => { setError(null); setNotice(null); }}
        >
          {error || notice} — dismiss
        </div>
      )}

      <div className="pa-contacts-list">
        {loading && <div className="pa-muted" style={{ padding: 20 }}>Loading orders…</div>}
        {!loading && items.length === 0 && !error && (
          <div className="pa-empty" style={{ minHeight: 160 }}>
            <div className="pa-empty-title">No orders found</div>
            <div className="pa-muted">{q ? "Try a different search." : "Orders from your store will appear here."}</div>
          </div>
        )}

        {items.map((o) => {
          const tone = statusTone(o.financial_status, o.fulfillment_status);
          const phone = o.customer_phone;
          const email = o.customer_email;
          const noContact = !phone && !email;
          const busy = busyId === o.id;
          const adminId = gidToId(o.id);
          return (
            <div
              key={o.id}
              className="pa-ord-row"
              onClick={() => !noContact && openFor(o, null)}
              style={noContact ? { cursor: "default" } : undefined}
              title={noContact ? "No contact details on this order" : "Open conversation"}
            >
              <div className="pa-ord-main">
                <div className="pa-ord-top">
                  <span className="pa-ord-num">{o.order_number}</span>
                  <span className="pa-order-badge" style={{ background: tone.bg, color: tone.color }}>{tone.label}</span>
                  <span className="pa-ord-cust">{o.customer_name || "Unknown customer"}</span>
                </div>
                <div className="pa-ord-sub">
                  {dateShort(o.created_at)}
                  {phone ? ` · ${phone}` : ""}
                  {email ? ` · ${email}` : ""}
                  {noContact ? " · no contact details" : ""}
                </div>
                {o.line_items?.length > 0 && <div className="pa-ord-items">{itemSummary(o.line_items)}</div>}
              </div>

              <div className="pa-ord-side">
                <span className="pa-ord-total">{formatOpsMoney(o.total)}</span>
                <button className="pa-ord-btn" disabled={!phone || busy} onClick={(e) => act(e, o, "sms")} title={phone ? "Message on SMS" : "No phone number on this order"}>SMS</button>
                <button className="pa-ord-btn" disabled={!phone || busy} onClick={(e) => act(e, o, "whatsapp")} title={phone ? "Message on WhatsApp" : "No phone number on this order"}>WhatsApp</button>
                <button className="pa-ord-btn" disabled={!email || busy} onClick={(e) => act(e, o, "email")} title={email ? "Open conversation (email is view-only in the hub)" : "No email on this order"}>Email</button>
                {adminId && (
                  <a
                    className="pa-ord-admin"
                    href={`${ADMIN_BASE}/orders/${adminId}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title="Open in Shopify admin"
                  >↗</a>
                )}
              </div>
            </div>
          );
        })}

        {hasMore && (
          <div className="pa-ord-more">
            <button className="pa-btn" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
