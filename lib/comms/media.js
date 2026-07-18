/**
 * Media library — store a reusable asset (video / PDF / image) once, send it many times.
 *
 * Storage is Supabase now, Cloudflare R2 later (see migration 0007 + the pipeline plan). The
 * contract that makes that swap cheap: callers ask the REGISTRY for a URL, never Supabase
 * directly. When we move to R2, we re-upload and rewrite `public_url`; nothing else changes.
 *
 * Delivery is by public URL because we send WhatsApp on Twilio, which fetches `MediaUrl`
 * itself — no Meta media-id upload needed.
 */
const crypto = require("crypto");
const { getSupabase } = require("../supabase");
const { cleanEnv } = require("../shopify");

const BUCKET = cleanEnv("MEDIA_BUCKET") || "media";

const KIND_TO_WA_TYPE = { video: "video", image: "image", pdf: "document" };

function bucketName() {
  return BUCKET;
}

/** Create the public bucket if it isn't there yet. Idempotent — safe to call on every upload. */
async function ensureBucket(sb) {
  const { data } = await sb.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await sb.storage.createBucket(BUCKET, { public: true });
  // A concurrent create is fine; only surface a genuinely different failure.
  if (error && !/exists/i.test(error.message)) throw error;
}

/** Public URL for a stored object, via the registry's storage coordinates. */
function publicUrlFor(sb, storageKey) {
  return sb.storage.from(BUCKET).getPublicUrl(storageKey).data.publicUrl;
}

/**
 * Upload a buffer and register it. Idempotent on `asset_key`: re-uploading the same key
 * replaces the object and updates the row, so fixing a bad clip doesn't orphan anything.
 *
 * @returns the registry row.
 */
async function uploadAsset({ assetKey, title, kind, funnelStep = null, buffer, mime, filename }) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured.");
  if (!assetKey || !buffer?.length) throw new Error("assetKey and a non-empty buffer are required.");
  if (!KIND_TO_WA_TYPE[kind]) throw new Error(`kind must be one of: ${Object.keys(KIND_TO_WA_TYPE).join(", ")}`);

  await ensureBucket(sb);

  const ext = (filename && filename.includes(".") ? filename.split(".").pop() : "") || "";
  const storageKey = ext ? `${assetKey}.${ext}` : assetKey;

  const { error: upErr } = await sb.storage.from(BUCKET).upload(storageKey, buffer, {
    contentType: mime || "application/octet-stream",
    upsert: true,
  });
  if (upErr) throw upErr;

  const row = {
    asset_key: assetKey,
    title: title || assetKey,
    kind,
    funnel_step: funnelStep,
    storage_provider: "supabase",
    storage_bucket: BUCKET,
    storage_key: storageKey,
    public_url: publicUrlFor(sb, storageKey),
    mime: mime || null,
    size_bytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    status: "ready",
  };

  const { data, error } = await sb
    .from("media_assets")
    .upsert(row, { onConflict: "asset_key" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function getAsset(assetKey) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("media_assets").select("*").eq("asset_key", assetKey).maybeSingle();
  return data || null;
}

async function listAssets({ kind, funnelStep } = {}) {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from("media_assets").select("*").eq("status", "ready").order("created_at", { ascending: false });
  if (kind) q = q.eq("kind", kind);
  if (funnelStep) q = q.eq("funnel_step", funnelStep);
  const { data } = await q;
  return data || [];
}

/** Turn a registered asset into the `media` object the send service expects. */
function toSendMedia(asset, caption) {
  return { url: asset.public_url, type: KIND_TO_WA_TYPE[asset.kind] || "document", caption: caption || undefined };
}

/**
 * Send a registered asset over WhatsApp through the shared send service (so it threads and
 * logs like any other outbound message). Kept as a thin wrapper to avoid a require cycle:
 * send.js does not depend on media.js.
 */
async function sendAssetOnWhatsApp({ to, assetKey, caption, author = "ai", contact = null }) {
  const asset = await getAsset(assetKey);
  if (!asset) throw new Error(`media asset not found: ${assetKey}`);
  const send = require("./send");
  return send.sendMessage({ channel: "whatsapp", to, media: toSendMedia(asset, caption), author, contact });
}

module.exports = { bucketName, ensureBucket, uploadAsset, getAsset, listAssets, toSendMedia, sendAssetOnWhatsApp };
