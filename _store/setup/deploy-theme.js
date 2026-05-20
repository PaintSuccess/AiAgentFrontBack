// deploy-theme.js — Deploys the Paint Access Support Widget to Shopify theme.
//
// Approach: Connect to the logged-in Chrome session via CDP, then use the
// Shopify Admin internal API (authenticated via browser session cookies) to
// PUT theme assets directly. No code editor UI automation needed.
//
// Usage:
//   1. Make sure Chrome is running with --remote-debugging-port=9222
//   2. Log in to Shopify admin in that Chrome window
//   3. Run: node deploy-theme.js

import 'dotenv/config';
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { spawn } from 'child_process';

const __dir  = dirname(fileURLToPath(import.meta.url));
const THEME  = resolve(__dir, '../theme');

const STORE_SLUG    = process.env.SHOPIFY_STORE_SLUG || 'zgmzge-0d';
const ADMIN_BASE    = `https://admin.shopify.com/store/${STORE_SLUG}`;
const TIMEOUT_LOGIN = 5 * 60 * 1000;
const DEBUG_PORT    = 9222;

const SNIPPET_CONTENT = readFileSync(resolve(THEME, 'snippets/ai-support-widget.liquid'), 'utf8');
const THEME_LIQUID    = readFileSync(resolve(THEME, 'layout/theme.liquid'), 'utf8');

async function getLiveThemeId(page, adminBase) {
  return page.evaluate(async (adminBase) => {
    const sd = JSON.parse(document.querySelector('[data-serialized-id="server-data"]')?.textContent || '{}');
    const csrf = sd.csrfToken || '';
    const r = await fetch(`${adminBase}/api/2024-01/graphql.json`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ query: '{ themes(first: 20) { nodes { id role } } }' })
    });
    const json = await r.json();
    const main = json?.data?.themes?.nodes?.find(n => n.role === 'MAIN');
    return main ? main.id.replace('gid://shopify/OnlineStoreTheme/', '') : null;
  }, adminBase);
}

async function putAsset(page, adminBase, themeId, key, value) {
  return page.evaluate(async ({ adminBase, themeId, key, value }) => {
    const sd = JSON.parse(document.querySelector('[data-serialized-id="server-data"]')?.textContent || '{}');
    const csrf = sd.csrfToken || '';
    const r = await fetch(`${adminBase}/api/2024-01/themes/${themeId}/assets.json`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Accept': 'application/json' },
      body: JSON.stringify({ asset: { key, value } })
    });
    const text = await r.text();
    return { status: r.status, ok: r.ok, preview: text.slice(0, 300) };
  }, { adminBase, themeId, key, value });
}

async function main() {
  console.log('');
  console.log('=== Paint Access — Deploy Support Widget ===');
  console.log(`Snippet: ${SNIPPET_CONTENT.length} chars | theme.liquid: ${THEME_LIQUID.length} chars`);
  console.log('');

  let browser, chromeProc = null;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`, { timeout: 5000 });
    console.log('Connected to existing Chrome.\n');
  } catch {
    const CHROME_EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const tmpProfile = resolve(os.tmpdir(), 'pa-deploy-profile');
    mkdirSync(tmpProfile, { recursive: true });
    console.log('Launching Chrome...');
    chromeProc = spawn(CHROME_EXE, [
      `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${tmpProfile}`,
      '--no-first-run', '--no-default-browser-check', ADMIN_BASE,
    ], { detached: true, stdio: 'ignore' });
    chromeProc.unref();
    await new Promise(r => setTimeout(r, 3000));
    browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
    console.log('Connected to new Chrome.\n');
  }

  const context = browser.contexts()[0] || await browser.newContext();
  const page    = context.pages()[0]    || await context.newPage();

  try {
    if (!page.url().includes('admin.shopify.com/store/' + STORE_SLUG)) {
      await page.goto(ADMIN_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
    }
    console.log('Admin URL:', page.url().slice(0, 80));

    const themeId = await getLiveThemeId(page, ADMIN_BASE);
    if (!themeId) throw new Error('Could not get live theme ID — is Chrome logged in to Shopify admin?');
    console.log('Live theme ID:', themeId, '\n');

    console.log('Uploading snippets/ai-support-widget.liquid...');
    const r1 = await putAsset(page, ADMIN_BASE, themeId, 'snippets/ai-support-widget.liquid', SNIPPET_CONTENT);
    if (!r1.ok) throw new Error(`Snippet upload failed (${r1.status}): ${r1.preview}`);
    console.log('  ✓ Snippet uploaded\n');

    console.log('Uploading layout/theme.liquid...');
    const r2 = await putAsset(page, ADMIN_BASE, themeId, 'layout/theme.liquid', THEME_LIQUID);
    if (!r2.ok) throw new Error(`theme.liquid upload failed (${r2.status}): ${r2.preview}`);
    console.log('  ✓ theme.liquid uploaded\n');

    console.log('=== DEPLOYMENT COMPLETE ===');
    console.log('Test: https://www.paintaccess.com.au/?ai-widget=1');
  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    await browser.close();
    if (chromeProc) chromeProc.kill();
  }
}

main().catch(console.error);
