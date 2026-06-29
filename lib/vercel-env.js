const { cleanEnv } = require("./shopify");

async function upsertVercelEnv(vars, options = {}) {
  const token = cleanEnv("VERCEL_API_TOKEN") || cleanEnv("VERCEL_ACCESS_TOKEN");
  const project =
    cleanEnv("VERCEL_PROJECT_ID_OR_NAME") ||
    cleanEnv("VERCEL_PROJECT_ID") ||
    cleanEnv("VERCEL_PROJECT_NAME");
  if (!token || !project) {
    return {
      skipped: true,
      reason: "VERCEL_API_TOKEN and VERCEL_PROJECT_ID_OR_NAME are not configured.",
    };
  }

  const targets = (options.targets || cleanEnv("VERCEL_ENV_TARGETS") || "production")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const query = new URLSearchParams({ upsert: "true" });
  const teamId = cleanEnv("VERCEL_TEAM_ID");
  const teamSlug = cleanEnv("VERCEL_TEAM_SLUG");
  if (teamId) query.set("teamId", teamId);
  if (teamSlug) query.set("slug", teamSlug);

  const results = [];
  for (const [key, value] of Object.entries(vars)) {
    if (!value) continue;
    const res = await fetch(
      `https://api.vercel.com/v10/projects/${encodeURIComponent(project)}/env?${query}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key,
          value,
          type: "encrypted",
          target: targets,
          comment: options.comment || "Updated by PaintAccess admin OAuth callback.",
        }),
      }
    );
    const json = await res.json().catch(() => ({}));
    results.push({ key, ok: res.ok, status: res.status, response: json });
  }

  const failed = results.filter((item) => !item.ok);
  return { skipped: false, ok: failed.length === 0, results };
}

async function triggerDeployHook(urlEnvNames = []) {
  const names = [...urlEnvNames, "VERCEL_DEPLOY_HOOK_URL"];
  const url = names.map((name) => cleanEnv(name)).find(Boolean);
  if (!url) return { skipped: true, reason: "No deploy hook configured." };
  const res = await fetch(url, { method: "POST" });
  const body = await res.text().catch(() => "");
  return { skipped: false, ok: res.ok, status: res.status, body: body.slice(0, 500) };
}

module.exports = {
  triggerDeployHook,
  upsertVercelEnv,
};
