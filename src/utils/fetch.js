/**
 * Fetch wrapper for dashboard API calls.
 * Uses Shopify App Bridge session tokens when inside Shopify Admin.
 * Falls back to unauthenticated for direct access (dev mode).
 */
export async function dashboardFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };

  // App Bridge v4: window.shopify is injected by the CDN script + meta tag
  try {
    if (window.shopify && typeof window.shopify.idToken === "function") {
      const token = await window.shopify.idToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }
  } catch (e) {
    // Not inside Shopify Admin — continue without token
  }

  const res = await fetch(path, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}
