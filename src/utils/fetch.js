/**
 * Fetch wrapper for dashboard API calls.
 * When running inside Shopify Admin, uses App Bridge session tokens.
 * Falls back to a simple cookie/header-based auth for development.
 */
export async function dashboardFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };

  // If running inside Shopify Admin iframe, App Bridge is available
  if (window.shopify?.idToken) {
    try {
      const token = await window.shopify.idToken();
      headers["Authorization"] = `Bearer ${token}`;
    } catch (e) {
      console.warn("App Bridge token not available:", e.message);
    }
  }

  const res = await fetch(path, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}
