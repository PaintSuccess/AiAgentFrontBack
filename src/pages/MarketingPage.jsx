import React, { useState, useEffect, useCallback } from "react";
import { dashboardFetch } from "../utils/fetch";
import "./marketing.css";

/**
 * Marketing — deliberately NOT a campaign builder.
 *
 * Campaigns, email design and automation flows live in Omnisend, which is already paid for
 * and natively synced to Shopify; duplicating them here would recreate the split-brain we
 * just untangled. This page covers the three things Omnisend structurally cannot see:
 * who we may legally contact (it has no WhatsApp/calls consent), which Meta ad a lead came
 * from, and whether a channel can actually deliver.
 *
 * Every number is read from data we hold. Nothing is projected or estimated.
 */

const CONSENT_LABELS = {
  subscribed: "Opted in",
  unknown: "Not asked",
  not_subscribed: "Declined",
  unsubscribed: "Opted out",
  none: "No address",
};
const CONSENT_ORDER = ["subscribed", "unknown", "not_subscribed", "unsubscribed", "none"];
const CONSENT_COLORS = {
  subscribed: "#12b76a",
  unknown: "#d0d5dd",
  not_subscribed: "#fdb022",
  unsubscribed: "#f04438",
  none: "#f2f3f5",
};
const CHANNEL_LABELS = { sms: "SMS", whatsapp: "WhatsApp", chat: "Website chat", voice: "Voice", email: "Email", unknown: "Other" };

const pct = (n, total) => (total > 0 ? (n / total) * 100 : 0);
const stamp = (iso) =>
  iso ? new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

function AudienceCard({ data }) {
  const total = CONSENT_ORDER.reduce((sum, k) => sum + (data[k] || 0), 0);
  const reachable = data.subscribed || 0;
  const addressable = total - (data.none || 0);
  return (
    <div className="pa-mkt-card pa-aud">
      <div className="pa-aud-top">
        <span className="pa-aud-ch">{data.label}</span>
        <span className="pa-aud-engine">{data.engine}</span>
      </div>
      <div className="pa-aud-n">
        {reachable}
        <small>can be marketed to</small>
      </div>
      <div className="pa-aud-cap">
        {addressable === 0
          ? "No contacts have an address on this channel"
          : `of ${addressable} with an address on file`}
      </div>
      <div className="pa-bar" role="img" aria-label={`${reachable} of ${total} opted in`}>
        {CONSENT_ORDER.map((k) =>
          data[k] ? <span key={k} className={`s-${k}`} style={{ width: `${pct(data[k], total)}%` }} /> : null
        )}
      </div>
      <div className="pa-legend">
        {CONSENT_ORDER.filter((k) => data[k]).map((k) => (
          <span key={k}>
            <i style={{ background: CONSENT_COLORS[k], border: k === "none" ? "1px solid #e4e4e7" : "none" }} />
            {CONSENT_LABELS[k]} <b>{data[k]}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function ReachRow({ c }) {
  const label = CHANNEL_LABELS[c.key] || c.key;
  // No settled sends = nothing to rate. Say so rather than implying 0%.
  const rated = c.settled > 0;
  // A low rate driven by a single contact is a bad conversation, not a bad channel — don't
  // colour it like an outage.
  const concentrated = c.failedPeople === 1 && c.people > 1;
  const tone = !rated || concentrated ? "" : c.deliveredRate < 75 ? "is-bad" : c.deliveredRate < 90 ? "is-warn" : "";
  return (
    <div className="pa-reach-row">
      <div className="pa-reach-ch">
        {label}
        <small>
          {c.inbound} in · {c.outbound} out
        </small>
      </div>
      {rated ? (
        <div className="pa-reach-bar" role="img" aria-label={`${c.deliveredRate}% delivered`}>
          <span className="d" style={{ width: `${pct(c.delivered, c.settled + c.pending)}%` }} />
          <span className="f" style={{ width: `${pct(c.failed, c.settled + c.pending)}%` }} />
          <span className="p" style={{ width: `${pct(c.pending, c.settled + c.pending)}%` }} />
        </div>
      ) : (
        <div className="pa-reach-nums" style={{ textAlign: "left" }}>
          {c.outbound === 0 ? "Inbound only — nothing sent on this channel" : "Awaiting delivery receipts"}
        </div>
      )}
      <div className="pa-reach-nums">
        {rated ? (
          <>
            <span className={`pa-reach-rate ${tone}`}>{c.deliveredRate}% delivered</span>
            <div>
              {c.delivered} delivered · {c.failed} failed
              {c.pending ? ` · ${c.pending} no receipt` : ""}
            </div>
            {c.failed > 0 && (
              <div style={{ fontSize: 11.5, color: "var(--pa-ink-3)" }}>
                across {c.failedPeople} {c.failedPeople === 1 ? "person" : "people"} · {c.people} messaged
              </div>
            )}
          </>
        ) : (
          <span className="pa-reach-rate">—</span>
        )}
      </div>
    </div>
  );
}

export default function MarketingPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await dashboardFetch("/api/comms/marketing"));
    } catch (err) {
      setError(err?.message || "Could not load marketing data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) return <div className="pa-mkt"><div className="pa-mkt-skel">Loading marketing data…</div></div>;

  const audience = data?.audience;
  const attribution = data?.attribution;
  const reach = data?.reach;
  const templates = data?.templates;
  // Only flag a channel when failures span multiple people. One contact failing repeatedly is a
  // conversation problem; calling it a channel problem is how we mistook our own testing for a
  // 41% outage on 16 Jul.
  const worstChannel = reach?.channels?.find(
    (c) => c.settled > 0 && c.deliveredRate < 75 && c.failedPeople > 1
  );

  return (
    <div className="pa-mkt">
      <div className="pa-mkt-inner">
        <div className="pa-mkt-head">
          <h1>Marketing</h1>
          <div className="pa-mkt-sub">
            Campaigns, email design and automation run in <strong>Omnisend</strong> — this page doesn't
            duplicate them. It covers what Omnisend can't see: <strong>who you're allowed to contact</strong>,
            <strong> which ad a lead came from</strong>, and <strong>whether a channel can actually deliver</strong>.
          </div>
        </div>

        <div className="pa-mkt-meta">
          <button className="pa-mkt-refresh" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          {data?.generatedAt && <span className="pa-mkt-stamp">Updated {stamp(data.generatedAt)}</span>}
        </div>

        {error && (
          <div className="pa-mkt-card pa-mkt-err">
            <div className="pa-empty">
              <div className="pa-empty-t">Couldn't load marketing data</div>
              <div className="pa-empty-d">{error}</div>
            </div>
          </div>
        )}

        {/* ── Audience ─────────────────────────────────────────────── */}
        {audience && (
          <section className="pa-mkt-sec">
            <div className="pa-mkt-sec-head">
              <h2>Who you can reach</h2>
              <span className="pa-mkt-sec-note">
                {audience.totalContacts} contacts
                {audience.excludedInternal > 0 && ` · ${audience.excludedInternal} internal excluded`}
              </span>
            </div>
            <p className="pa-mkt-sec-desc">
              Marketing consent per channel. Email and SMS mirror Shopify; WhatsApp and calls are held
              only here, so this is the only place they can be seen. “No address” means we hold no way to
              reach that person on that channel at all — they can never be marketed to there, opted in or not.
              {audience.excludedInternal > 0 && (
                <>
                  {" "}Staff and test contacts (tagged <code>internal_test</code>) are excluded from every
                  number on this page.
                </>
              )}
            </p>
            <div className="pa-mkt-grid">
              {Object.entries(audience.channels).map(([key, c]) => (
                <AudienceCard key={key} data={c} />
              ))}
            </div>
            {audience.truncated && (
              <div className="pa-note is-warn">
                <div>
                  <b>Counts are capped.</b> More contacts exist than this page scans, so these totals are a
                  floor, not a full count.
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Attribution ──────────────────────────────────────────── */}
        <section className="pa-mkt-sec">
          <div className="pa-mkt-sec-head">
            <h2>Where leads come from</h2>
            {attribution?.adSourcedContacts > 0 && (
              <span className="pa-mkt-sec-note">{attribution.adSourcedContacts} ad-sourced contacts</span>
            )}
          </div>
          <p className="pa-mkt-sec-desc">
            When someone clicks a Meta “Send WhatsApp” ad, Meta passes the ad's click id once — on that
            first message only, and never again. It's captured on arrival and shown here.
          </p>
          <div className="pa-mkt-card">
            {attribution?.ads?.length ? (
              <table className="pa-ads">
                <thead>
                  <tr>
                    <th>Ad</th>
                    <th className="num">People</th>
                    <th className="num">Clicks</th>
                    <th className="num">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {attribution.ads.map((ad) => (
                    <tr key={ad.sourceId || ad.headline}>
                      <td>
                        <div className="hl">{ad.headline || "(no headline)"}</div>
                        <div className="sub">
                          {ad.sourceType || "ad"}
                          {ad.sourceId ? ` · ${ad.sourceId}` : ""}
                        </div>
                      </td>
                      <td className="num">{ad.contacts}</td>
                      <td className="num">{ad.touches}</td>
                      <td className="num">{stamp(ad.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="pa-empty">
                <div className="pa-empty-live">
                  <i />
                  Capture is live
                </div>
                <div className="pa-empty-t">No ad-driven conversations yet</div>
                <div className="pa-empty-d">
                  Nothing to show until a Click-to-WhatsApp ad runs. The tracking is in place and waiting,
                  so the first ad click will be attributed — but only clicks from now on. Any ad that ran
                  before this was switched on can't be recovered.
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Deliverability ───────────────────────────────────────── */}
        {reach && (
          <section className="pa-mkt-sec">
            <div className="pa-mkt-sec-head">
              <h2>Can we actually deliver?</h2>
              <span className="pa-mkt-sec-note">last {reach.windowDays} days</span>
            </div>
            <p className="pa-mkt-sec-desc">
              Delivery outcomes per channel. Rates count only messages with a confirmed outcome — a send
              still awaiting a receipt is shown separately, never counted as a failure. Failures show how
              many <em>people</em> they affect: a low rate driven by one contact is a bad conversation, not
              a bad channel.
            </p>
            <div className="pa-mkt-card pa-reach">
              {reach.channels.map((c) => (
                <ReachRow key={c.key} c={c} />
              ))}
            </div>
            {worstChannel && (
              <div className="pa-note is-warn">
                <div>
                  <b>
                    {CHANNEL_LABELS[worstChannel.key] || worstChannel.key} is failing {worstChannel.failedRate}% of
                    settled sends.
                  </b>{" "}
                  Worth resolving before spending on this channel — common causes are messaging outside the
                  24-hour window without an approved template, and Twilio geographic permissions for the
                  recipient's country.
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Templates ────────────────────────────────────────────── */}
        <section className="pa-mkt-sec">
          <div className="pa-mkt-sec-head">
            <h2>Approved marketing messages</h2>
            <span className="pa-mkt-sec-note">WhatsApp · live from Twilio</span>
          </div>
          <p className="pa-mkt-sec-desc">
            Outside the 24-hour reply window, WhatsApp only allows a Meta-approved template. These are the
            ones approved as <em>marketing</em>; newly approved templates appear here automatically.
          </p>
          <div className="pa-mkt-card">
            {!templates?.available ? (
              <div className="pa-empty">
                <div className="pa-empty-t">Template list unavailable</div>
                <div className="pa-empty-d">Couldn't reach Twilio to read approved templates. The rest of this page is unaffected.</div>
              </div>
            ) : templates.items.length ? (
              templates.items.map((t) => (
                <div className="pa-tpl" key={t.sid}>
                  <div className="pa-tpl-top">
                    <span className="pa-tpl-name">{t.name}</span>
                    <span className="pa-tpl-cat">{t.category}</span>
                  </div>
                  <div className="pa-tpl-body">{t.body}</div>
                </div>
              ))
            ) : (
              <div className="pa-empty">
                <div className="pa-empty-t">No marketing templates approved yet</div>
                <div className="pa-empty-d">
                  {templates.utilityCount} utility template{templates.utilityCount === 1 ? "" : "s"} exist, but
                  those can't be used for marketing.
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── System map ───────────────────────────────────────────── */}
        <section className="pa-mkt-sec">
          <div className="pa-mkt-sec-head">
            <h2>Where marketing actually runs</h2>
          </div>
          <p className="pa-mkt-sec-desc">
            Which system owns which channel, so nothing gets sent twice or assumed to be handled.
          </p>
          <div className="pa-mkt-card">
            <div className="pa-map-row">
              <div className="pa-map-what">Email marketing</div>
              <div className="pa-map-where">
                Campaigns, abandoned cart and post-purchase flows run in{" "}
                <a href="https://app.omnisend.com" target="_blank" rel="noreferrer">Omnisend</a>, synced natively to Shopify.
              </div>
              <span className="pa-pill ext">Omnisend</span>
            </div>
            <div className="pa-map-row">
              <div className="pa-map-what">Web push</div>
              <div className="pa-map-where">Included with Omnisend. Not currently in use.</div>
              <span className="pa-pill ext">Omnisend</span>
            </div>
            <div className="pa-map-row">
              <div className="pa-map-what">WhatsApp</div>
              <div className="pa-map-where">
                Runs here, through Twilio — Omnisend has no WhatsApp channel, so this can only live in this app.
              </div>
              <span className="pa-pill ok">This app</span>
            </div>
            <div className="pa-map-row">
              <div className="pa-map-what">SMS (1-to-1)</div>
              <div className="pa-map-where">Conversations and replies run here, through Twilio.</div>
              <span className="pa-pill ok">This app</span>
            </div>
            <div className="pa-map-row">
              <div className="pa-map-what">Voice</div>
              <div className="pa-map-where">Inbound and outbound AI calls, recorded and transcribed here.</div>
              <span className="pa-pill ok">This app</span>
            </div>
            <div className="pa-map-row">
              <div className="pa-map-what">Ad attribution</div>
              <div className="pa-map-where">Click-to-WhatsApp ad tracking, captured here on the first message.</div>
              <span className="pa-pill ok">This app</span>
            </div>
            <div className="pa-map-row">
              <div className="pa-map-what">Bulk SMS marketing</div>
              <div className="pa-map-where">
                Undecided. Omnisend only includes SMS on its Pro plan — if the account is on Standard, bulk SMS
                has to run through Twilio here instead.
              </div>
              <span className="pa-pill q">Needs a decision</span>
            </div>
            <div className="pa-map-row">
              <div className="pa-map-what">WhatsApp broadcast</div>
              <div className="pa-map-where">Sending a campaign to a segment on WhatsApp isn't built yet.</div>
              <span className="pa-pill no">Not built</span>
            </div>
            <div className="pa-map-row">
              <div className="pa-map-what">Reporting to Meta</div>
              <div className="pa-map-where">
                Sending leads and orders back to Meta, so ad targeting can optimise on real sales rather than
                just “conversation started”, isn't built yet.
              </div>
              <span className="pa-pill no">Not built</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
