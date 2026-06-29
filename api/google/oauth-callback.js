const { cleanEnv } = require("../../lib/shopify");
const {
  enableGoogleProjectServices,
  escapeHtml,
  exchangeGoogleCode,
  getGoogleCloudProjectId,
  getGoogleProjectServices,
  htmlPage,
  triggerDeployHook,
  upsertVercelEnv,
  verifyState,
} = require("../../lib/google-oauth-admin");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  const { code, error, error_description: errorDescription, state } = req.query;
  if (error) {
    return res.status(400).send(
      htmlPage(
        "Google OAuth failed",
        `<h1>Google OAuth failed</h1>
        <p><strong>${escapeHtml(error)}</strong></p>
        <p>${escapeHtml(errorDescription || "")}</p>`,
        "#b42318"
      )
    );
  }
  if (!code) {
    return res.status(400).send(
      htmlPage("Missing Google code", "<h1>Missing authorization code</h1>", "#b42318")
    );
  }

  const stateCheck = verifyState(state);
  if (!stateCheck.ok) {
    return res.status(403).send(
      htmlPage(
        "Invalid Google OAuth state",
        `<h1>Invalid OAuth state</h1><p>${escapeHtml(stateCheck.reason)}</p>`,
        "#b42318"
      )
    );
  }

  try {
    const tokenData = await exchangeGoogleCode({ code, req });
    if (stateCheck.data?.mode === "google_services_enable") {
      const enableResult = await enableGoogleProjectServices({
        accessToken: tokenData.access_token,
        projectId: getGoogleCloudProjectId(),
        services: getGoogleProjectServices(),
      });
      const body = `<h1>Google project services setup ${enableResult.ok ? "started" : "failed"}</h1>
        <div class="card">
          <p><strong>Project:</strong> ${escapeHtml(enableResult.projectId || "(missing)")}</p>
          <p><strong>Services:</strong> ${escapeHtml(
            enableResult.results.map((item) => `${item.service}: ${item.ok ? "ok" : `failed (${item.status})`}`).join(", ")
          )}</p>
          <p><strong>Scopes:</strong> ${escapeHtml(tokenData.scope || "(none)")}</p>
        </div>
        <details>
          <summary>Technical result</summary>
          <pre>${escapeHtml(JSON.stringify(enableResult, null, 2))}</pre>
        </details>
        <p class="muted">Google may need a few minutes to propagate newly enabled APIs.</p>`;

      return res
        .status(enableResult.ok ? 200 : 502)
        .send(htmlPage("Google project services setup", body, enableResult.ok ? "#116329" : "#b42318"));
    }

    const refreshToken = tokenData.refresh_token || "";
    const workspaceEmail = cleanEnv("GOOGLE_WORKSPACE_EMAIL");

    if (!refreshToken) {
      return res.status(200).send(
        htmlPage(
          "Google OAuth completed without refresh token",
          `<h1 class="warn">Google OAuth completed, but no refresh token was returned</h1>
          <p>This usually means the account already granted consent. Revoke the app in Google Account access, then run the authorization URL again.</p>
          <div class="card">
            <p><strong>Scopes returned:</strong> ${escapeHtml(tokenData.scope || "(none)")}</p>
            <p><strong>Access token returned:</strong> ${tokenData.access_token ? "yes" : "no"}</p>
          </div>`,
          "#9a3412"
        )
      );
    }

    const vars = {
      GOOGLE_REFRESH_TOKEN: refreshToken,
      ...(workspaceEmail ? { GOOGLE_WORKSPACE_EMAIL: workspaceEmail } : {}),
    };
    const storeResult = await upsertVercelEnv(vars, {
      targets: cleanEnv("GOOGLE_OAUTH_VERCEL_TARGETS") || cleanEnv("VERCEL_ENV_TARGETS") || "production",
      comment: "Updated by PaintAccess Google OAuth admin callback.",
    });
    const deployResult = storeResult.ok
      ? await triggerDeployHook(["GOOGLE_OAUTH_DEPLOY_HOOK_URL"])
      : { skipped: true };

    const stored = storeResult.ok && !storeResult.skipped;
    const body = `<h1>Google OAuth successful</h1>
      <div class="card">
        <p><strong>Refresh token:</strong> received</p>
        <p><strong>Scopes:</strong> ${escapeHtml(tokenData.scope || "(none)")}</p>
        <p><strong>Vercel auto-store:</strong> ${stored ? "completed" : "not completed"}</p>
        <p><strong>Deploy hook:</strong> ${
          deployResult.skipped ? "not configured" : deployResult.ok ? "triggered" : "failed"
        }</p>
      </div>
      ${
        stored
          ? `<p>The token was written to Vercel. If no deploy hook is configured, redeploy production so the running backend picks up the new env var.</p>`
          : `<p class="warn">Automatic Vercel storage was skipped or failed. Copy this value into Vercel as <code>GOOGLE_REFRESH_TOKEN</code>.</p>
             <textarea readonly>${escapeHtml(refreshToken)}</textarea>`
      }
      <details>
        <summary>Technical result</summary>
        <pre>${escapeHtml(JSON.stringify({ storeResult, deployResult }, null, 2))}</pre>
      </details>
      <p class="muted">Do not share this page. Close it after confirming Vercel is updated.</p>`;

    return res.status(200).send(htmlPage("Google OAuth successful", body));
  } catch (err) {
    return res.status(err.statusCode || 500).send(
      htmlPage(
        "Google OAuth token exchange failed",
        `<h1>Google OAuth token exchange failed</h1>
        <p>${escapeHtml(err.message || "Unknown error")}</p>
        <pre>${escapeHtml(JSON.stringify(err.google || {}, null, 2))}</pre>`,
        "#b42318"
      )
    );
  }
};
