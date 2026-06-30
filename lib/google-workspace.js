const { cleanEnv } = require("./shopify");
const { ensurePaintAccessSignature } = require("./paintaccess-email-templates");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

function requireGoogleConfig() {
  const missing = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"].filter(
    (name) => !cleanEnv(name)
  );
  if (missing.length) {
    const err = new Error(`Google Workspace credentials are not configured: ${missing.join(", ")}.`);
    err.code = "google_config_missing";
    err.statusCode = 500;
    err.missing = missing;
    throw err;
  }
}

async function getGoogleAccessToken() {
  requireGoogleConfig();
  const params = new URLSearchParams({
    client_id: cleanEnv("GOOGLE_CLIENT_ID"),
    client_secret: cleanEnv("GOOGLE_CLIENT_SECRET"),
    refresh_token: cleanEnv("GOOGLE_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Google OAuth ${res.status}: ${json.error_description || json.error || "token exchange failed"}`);
    err.statusCode = res.status;
    err.google = json;
    throw err;
  }
  return json.access_token;
}

async function googleFetch(url, options = {}) {
  const accessToken = await getGoogleAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body && !options.skipJson ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const contentType = res.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await res.json().catch(() => ({}))
    : await res.text();
  if (!res.ok) {
    const err = new Error(`Google API ${res.status}: ${typeof body === "string" ? body.slice(0, 300) : body.error?.message || "request failed"}`);
    err.statusCode = res.status;
    err.google = body;
    throw err;
  }
  return body;
}

async function gmailSearchMessages(input = {}) {
  const maxResults = Math.min(Math.max(parseInt(input.max_results, 10) || 10, 1), 25);
  const query = safeText(input.query || buildGmailQuery(input), 500);
  const url = `${GMAIL_API}/messages?${new URLSearchParams({ q: query, maxResults: String(maxResults) })}`;
  const data = await googleFetch(url);
  const messages = [];
  for (const item of data.messages || []) {
    messages.push(await getGmailMetadata(item.id));
  }
  return { query, count: messages.length, messages };
}

async function gmailGetMessage(input = {}) {
  const id = safeText(input.message_id || input.id, 200);
  if (!id) throwInput("message_id is required.");
  const url = `${GMAIL_API}/messages/${encodeURIComponent(id)}?format=full`;
  const data = await googleFetch(url);
  return mapGmailMessage(data, true);
}

async function gmailCreateDraft(input = {}) {
  const raw = buildRawEmail(input);
  const data = await googleFetch(`${GMAIL_API}/drafts`, {
    method: "POST",
    body: JSON.stringify({ message: { raw } }),
  });
  return { ok: true, draft_id: data.id, message_id: data.message?.id || null, thread_id: data.message?.threadId || null };
}

async function gmailSendEmail(input = {}) {
  const approvalReference = safeText(input.approval_reference, 200);
  if (!approvalReference) throwInput("approval_reference is required before sending Gmail.");
  const raw = buildRawEmail(input);
  const data = await googleFetch(`${GMAIL_API}/messages/send`, {
    method: "POST",
    body: JSON.stringify({ raw }),
  });
  return { ok: true, sent: true, message_id: data.id, thread_id: data.threadId || null, approval_reference: approvalReference };
}

async function driveSearchFiles(input = {}) {
  const maxResults = Math.min(Math.max(parseInt(input.max_results, 10) || 10, 1), 25);
  const q = buildDriveQuery(input);
  const params = new URLSearchParams({
    q,
    pageSize: String(maxResults),
    fields: "files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress))",
    orderBy: "modifiedTime desc",
  });
  const data = await googleFetch(`${DRIVE_API}/files?${params}`);
  return { query: q, count: (data.files || []).length, files: data.files || [] };
}

async function driveGetFile(input = {}) {
  const id = safeText(input.file_id || input.id, 200);
  if (!id) throwInput("file_id is required.");
  const metadata = await googleFetch(
    `${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,modifiedTime,webViewLink,size`
  );
  let content = null;
  if (input.include_content !== false) {
    content = await getDriveFileContent(metadata, input.export_mime_type);
  }
  return { metadata, content_preview: content ? String(content).slice(0, 12000) : null };
}

async function driveCreateTextFile(input = {}) {
  const name = safeText(input.name, 240);
  const content = String(input.content || "").slice(0, 200000);
  if (!name) throwInput("name is required.");
  if (!content) throwInput("content is required.");

  const metadata = {
    name,
    mimeType: input.mime_type || "text/plain",
    ...(input.folder_id ? { parents: [safeText(input.folder_id, 200)] } : {}),
  };
  const boundary = `paintaccess-${Date.now()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${metadata.mimeType}; charset=UTF-8`,
    "",
    content,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const data = await googleFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink",
    {
      method: "POST",
      skipJson: true,
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }
  );
  return { ok: true, file: data };
}

async function getGmailMetadata(id) {
  const url = `${GMAIL_API}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`;
  const data = await googleFetch(url);
  return mapGmailMessage(data, false);
}

function mapGmailMessage(data, includeBody) {
  const headers = {};
  for (const header of data.payload?.headers || []) {
    headers[header.name.toLowerCase()] = header.value;
  }
  return {
    id: data.id,
    thread_id: data.threadId,
    snippet: data.snippet || "",
    from: headers.from || null,
    to: headers.to || null,
    subject: headers.subject || null,
    date: headers.date || null,
    body_text: includeBody ? extractBodyText(data.payload).slice(0, 12000) : undefined,
  };
}

function extractBodyText(part) {
  if (!part) return "";
  const data = part.body?.data;
  if (data && String(part.mimeType || "").includes("text/plain")) {
    return Buffer.from(data, "base64url").toString("utf8");
  }
  return (part.parts || []).map(extractBodyText).filter(Boolean).join("\n\n");
}

async function getDriveFileContent(metadata, exportMimeType) {
  const mimeType = metadata.mimeType || "";
  if (mimeType.startsWith("application/vnd.google-apps.")) {
    const exportType = exportMimeType || "text/plain";
    return googleFetch(`${DRIVE_API}/files/${encodeURIComponent(metadata.id)}/export?mimeType=${encodeURIComponent(exportType)}`);
  }
  if (/text|json|csv|xml|markdown/.test(mimeType) || !mimeType) {
    return googleFetch(`${DRIVE_API}/files/${encodeURIComponent(metadata.id)}?alt=media`);
  }
  return null;
}

function buildRawEmail(input = {}) {
  const to = safeEmailList(input.to);
  if (!to) throwInput("to is required.");
  const subject = safeHeader(input.subject);
  if (!subject) throwInput("subject is required.");
  const body = ensurePaintAccessSignature(String(input.body_text || input.body || "").slice(0, 50000));
  if (!body) throwInput("body_text is required.");

  const headers = [
    `To: ${to}`,
    input.cc ? `Cc: ${safeEmailList(input.cc)}` : "",
    input.bcc ? `Bcc: ${safeEmailList(input.bcc)}` : "",
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ].filter(Boolean);

  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildGmailQuery(input = {}) {
  const parts = [];
  if (input.order_number) parts.push(String(input.order_number));
  if (input.from) parts.push(`from:${safeText(input.from, 200)}`);
  if (input.to) parts.push(`to:${safeText(input.to, 200)}`);
  if (input.subject) parts.push(`subject:(${safeText(input.subject, 200)})`);
  if (input.after) parts.push(`after:${safeText(input.after, 30)}`);
  if (input.before) parts.push(`before:${safeText(input.before, 30)}`);
  return parts.join(" ").trim() || "newer_than:30d";
}

function buildDriveQuery(input = {}) {
  const clauses = ["trashed = false"];
  if (input.query) clauses.push(`fullText contains '${escapeDriveQuery(input.query)}'`);
  if (input.name_contains) clauses.push(`name contains '${escapeDriveQuery(input.name_contains)}'`);
  if (input.mime_type) clauses.push(`mimeType = '${escapeDriveQuery(input.mime_type)}'`);
  if (input.folder_id) clauses.push(`'${escapeDriveQuery(input.folder_id)}' in parents`);
  return clauses.join(" and ");
}

function escapeDriveQuery(value) {
  return String(value || "").replace(/['\\]/g, " ").trim().slice(0, 200);
}

function safeHeader(value) {
  return safeText(value, 240).replace(/[\r\n:]/g, " ");
}

function safeEmailList(value) {
  return String(Array.isArray(value) ? value.join(",") : value || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter((item) => /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/.test(item))
    .join(", ");
}

function safeText(value, maxLength = 500) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>`]/g, "")
    .replace(/\s{3,}/g, " ")
    .trim()
    .slice(0, maxLength);
}

function throwInput(message) {
  const err = new Error(message);
  err.code = "invalid_input";
  err.statusCode = 400;
  throw err;
}

module.exports = {
  driveCreateTextFile,
  driveGetFile,
  driveSearchFiles,
  gmailCreateDraft,
  gmailGetMessage,
  gmailSearchMessages,
  gmailSendEmail,
};
