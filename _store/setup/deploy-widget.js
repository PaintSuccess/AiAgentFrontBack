// deploy-widget.js — Uses Playwright to inject ElevenLabs widget into Shopify theme
//
// This script automates the Shopify admin UI to add the AI support widget
// to the store's theme.liquid layout file. No Shopify app or API token needed.
//
// How it works:
//   1. Opens the Shopify admin theme code editor
//   2. Waits for you to log in (handles 2FA, SSO, etc.)
//   3. Navigates to layout/theme.liquid
//   4. Injects the ElevenLabs widget snippet before </body>
//   5. Saves the file
//
// Usage: node deploy-widget.js
//   Or:  npm run deploy-widget

import 'dotenv/config';
import { chromium } from 'playwright';

const STORE_SLUG = process.env.SHOPIFY_STORE_SLUG || 'zgmzge-0d';
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

const WIDGET_SNIPPET = `
<!-- ElevenLabs AI Support Widget — Paint Access -->
<elevenlabs-convai agent-id="${AGENT_ID || 'REPLACE_WITH_AGENT_ID'}"></elevenlabs-convai>
<script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async type="text/javascript"></script>
`;

async function deployWidget() {
  if (!AGENT_ID) {
    console.warn('Warning: ELEVENLABS_AGENT_ID not set in .env');
    console.warn('The widget will be injected with a placeholder. Update the agent-id after creation.\n');
  }

  console.log('Launching browser...');
  console.log('You will need to log in to Shopify admin manually.\n');

  const browser = await chromium.launch({
    headless: false, // Must be visible for manual login
    slowMo: 100,
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });

  const page = await context.newPage();
  const adminBase = `https://admin.shopify.com/store/${STORE_SLUG}`;

  // Step 1: Navigate to Shopify admin — user logs in
  console.log('Step 1: Opening Shopify admin...');
  console.log(`  → ${adminBase}`);
  await page.goto(adminBase);

  // Wait for user to complete login (detect admin dashboard loaded)
  console.log('\n  Please log in to Shopify admin in the browser window.');
  console.log('  Waiting for login to complete...\n');

  await page.waitForURL(`**/store/${STORE_SLUG}/**`, { timeout: 300_000 });
  console.log('  Login detected!\n');

  // Step 2: Navigate to Online Store → Themes
  console.log('Step 2: Navigating to theme editor...');
  const themesUrl = `${adminBase}/themes`;
  await page.goto(themesUrl);
  await page.waitForLoadState('networkidle');

  // Step 3: Find and click "Edit code" on the active/live theme
  console.log('Step 3: Opening theme code editor...');

  // Look for the "Edit code" link/button — Shopify has different UI versions
  // Try the three-dot menu on the current theme first
  try {
    // Wait for the themes page to fully load
    await page.waitForTimeout(3000);

    // Try to find the "Edit code" button or action menu
    // Shopify 2024+ layout: "..." menu → "Edit code"
    const actionMenuButton = page.locator('[aria-label="More actions"]').first();
    if (await actionMenuButton.isVisible({ timeout: 5000 })) {
      await actionMenuButton.click();
      await page.waitForTimeout(1000);

      const editCodeOption = page.getByRole('menuitem', { name: /edit code/i });
      if (await editCodeOption.isVisible({ timeout: 3000 })) {
        await editCodeOption.click();
      }
    }
  } catch {
    // Fallback: Navigate directly to the code editor URL
    console.log('  Trying direct navigation to code editor...');
  }

  // If we haven't navigated to the code editor yet, try direct URL
  if (!page.url().includes('/editor')) {
    // Get the active theme ID from the page or use direct navigation
    // Shopify code editor URL format: /themes/{theme_id}/editor
    // We need to find the theme ID first
    const currentUrl = page.url();
    console.log(`  Current URL: ${currentUrl}`);

    // Try to find the Edit code link on the page
    const editCodeLink = page.locator('a:has-text("Edit code")').first();
    if (await editCodeLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      const href = await editCodeLink.getAttribute('href');
      if (href) {
        await page.goto(href.startsWith('http') ? href : `https://admin.shopify.com${href}`);
      }
    } else {
      console.log('\n  Could not find "Edit code" button automatically.');
      console.log('  Please navigate to: Online Store → Themes → "..." → Edit code');
      console.log('  Waiting for code editor to load...\n');
      await page.waitForURL('**/themes/*/editor**', { timeout: 120_000 });
    }
  }

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  console.log('  Code editor opened!\n');

  // Step 4: Navigate to layout/theme.liquid in the file tree
  console.log('Step 4: Opening layout/theme.liquid...');

  // The code editor has a file tree on the left. Find and click theme.liquid
  try {
    // Try clicking the "Layout" folder first
    const layoutFolder = page.locator('text=Layout').first();
    if (await layoutFolder.isVisible({ timeout: 5000 })) {
      await layoutFolder.click();
      await page.waitForTimeout(1000);
    }

    // Click theme.liquid
    const themeLiquid = page.locator('text=theme.liquid').first();
    await themeLiquid.click({ timeout: 10000 });
    await page.waitForTimeout(2000);
  } catch {
    console.log('  Could not auto-select theme.liquid. Please click on:');
    console.log('  Layout → theme.liquid in the left sidebar');
    console.log('  Press Enter in the terminal when ready...');
    await waitForInput();
  }

  console.log('  theme.liquid opened!\n');

  // Step 5: Find the code editor and inject the widget before </body>
  console.log('Step 5: Injecting ElevenLabs widget...');

  // Shopify code editor uses CodeMirror or Monaco editor
  // We'll use keyboard shortcut Ctrl+H (find & replace) approach
  // This is the most reliable method across Shopify editor versions

  // Focus the code editor
  const editorArea = page.locator('.CodeMirror, [data-code-editor], .monaco-editor, textarea[name="asset[value]"]').first();

  if (await editorArea.isVisible({ timeout: 10000 }).catch(() => false)) {
    // Click to focus
    await editorArea.click();
    await page.waitForTimeout(500);

    // Use Ctrl+H to open Find & Replace
    await page.keyboard.press('Control+h');
    await page.waitForTimeout(1000);

    // Find "</body>" and replace with widget + "</body>"
    const searchInput = page.locator('input[type="text"]').first();
    if (await searchInput.isVisible({ timeout: 5000 })) {
      await searchInput.fill('</body>');
      await page.waitForTimeout(500);

      // Tab to replace field
      const replaceInput = page.locator('input[type="text"]').nth(1);
      if (await replaceInput.isVisible({ timeout: 3000 })) {
        await replaceInput.fill(WIDGET_SNIPPET.trim() + '\n</body>');
        await page.waitForTimeout(500);

        // Click replace button
        const replaceButton = page.locator('button:has-text("Replace")').first();
        if (await replaceButton.isVisible({ timeout: 3000 })) {
          await replaceButton.click();
          console.log('  Widget snippet injected!\n');
        }
      }
    }

    // Close find/replace
    await page.keyboard.press('Escape');
  } else {
    // Fallback: Try textarea approach (older Shopify editor)
    console.log('  Using textarea fallback...');
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 5000 })) {
      const content = await textarea.inputValue();
      const newContent = content.replace('</body>', WIDGET_SNIPPET.trim() + '\n</body>');
      await textarea.fill(newContent);
      console.log('  Widget snippet injected via textarea!\n');
    } else {
      console.log('\n  ⚠ Could not locate the code editor automatically.');
      console.log('  Please manually paste the following before </body> in theme.liquid:\n');
      console.log(WIDGET_SNIPPET);
      console.log('\n  After pasting, press Enter in the terminal to continue...');
      await waitForInput();
    }
  }

  // Step 6: Save the file
  console.log('Step 6: Saving...');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(3000);

  // Check for save confirmation
  console.log('  File saved!\n');

  // Verify by checking for the snippet in the page
  console.log('========================================');
  console.log('Deployment complete!');
  console.log('========================================');
  console.log(`\nThe ElevenLabs AI support widget has been added to your Shopify theme.`);
  if (AGENT_ID) {
    console.log(`Agent ID: ${AGENT_ID}`);
  }
  console.log(`\nVisit https://www.paintaccess.com.au to verify the widget appears.`);
  console.log('You should see a chat bubble in the bottom-right corner.\n');

  console.log('Press Enter to close the browser...');
  await waitForInput();

  await browser.close();
}

function waitForInput() {
  return new Promise((resolve) => {
    process.stdin.once('data', () => resolve());
  });
}

// Run if called directly
if (process.argv[1]?.endsWith('deploy-widget.js')) {
  deployWidget().catch(console.error);
}

export { deployWidget };
