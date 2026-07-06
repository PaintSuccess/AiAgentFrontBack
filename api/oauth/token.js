const {
  createAccessToken,
  createRefreshToken,
  getAccessTokenTtlSeconds,
  parseBody,
  verifyPkce,
  verifyRefreshToken,
  verifySignedPayload,
} = require("../../lib/mcp-auth");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = parseBody(req);
  if (!["authorization_code", "refresh_token"].includes(body.grant_type)) {
    return res.status(400).json({ error: "unsupported_grant_type" });
  }

  if (body.grant_type === "refresh_token") {
    const refresh = verifyRefreshToken(body.refresh_token);
    if (!refresh) return res.status(400).json({ error: "invalid_grant" });
    if (body.client_id && refresh.client_id && body.client_id !== refresh.client_id) {
      return res.status(400).json({ error: "invalid_client" });
    }

    const accessToken = createAccessToken({
      client_id: refresh.client_id,
      scope: refresh.scope,
      resource: body.resource || refresh.resource,
    });

    return res.status(200).json({
      access_token: accessToken,
      refresh_token: body.refresh_token,
      token_type: "Bearer",
      expires_in: getAccessTokenTtlSeconds(),
      scope: refresh.scope,
    });
  }

  const code = verifySignedPayload(body.code, "authorization_code");
  if (!code) return res.status(400).json({ error: "invalid_grant" });
  if (body.client_id && body.client_id !== code.client_id) {
    return res.status(400).json({ error: "invalid_client" });
  }
  if (body.redirect_uri && body.redirect_uri !== code.redirect_uri) {
    return res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
  }
  if (!verifyPkce(body.code_verifier, code.code_challenge, code.code_challenge_method)) {
    return res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
  }

  const accessToken = createAccessToken({
    client_id: code.client_id,
    scope: code.scope,
    resource: code.resource,
  });
  const refreshToken = createRefreshToken({
    client_id: code.client_id,
    scope: code.scope,
    resource: code.resource,
  });

  return res.status(200).json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: getAccessTokenTtlSeconds(),
    scope: code.scope,
  });
};
