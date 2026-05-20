// setup-all.js — Main orchestrator: runs all setup steps in sequence
//
// Usage:
//   1. Copy .env.example → .env and fill in your API keys
//   2. npm install
//   3. npm run install-browsers   (first time only)
//   4. npm run setup
//
// Or run each step individually:
//   npm run create-agent
//   npm run connect-phone
//   npm run deploy-widget

import 'dotenv/config';
import { createAgent } from './create-agent.js';
import { connectPhone } from './connect-phone.js';
import { deployWidget } from './deploy-widget.js';

const STEPS = [
  { name: 'Create ElevenLabs Agent', fn: createAgent, requires: ['ELEVENLABS_API_KEY'] },
  { name: 'Connect Twilio Phone', fn: connectPhone, requires: ['ELEVENLABS_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'] },
  { name: 'Deploy Widget to Shopify', fn: deployWidget, requires: [] },
];

async function main() {
  console.log('='.repeat(60));
  console.log('  Paint Access — AI Support Setup');
  console.log('  ElevenLabs + Twilio + Shopify');
  console.log('='.repeat(60));
  console.log();

  // Validate environment
  const missing = [];
  if (!process.env.ELEVENLABS_API_KEY) missing.push('ELEVENLABS_API_KEY');
  if (!process.env.TWILIO_ACCOUNT_SID) missing.push('TWILIO_ACCOUNT_SID');
  if (!process.env.TWILIO_AUTH_TOKEN) missing.push('TWILIO_AUTH_TOKEN');
  if (!process.env.TWILIO_PHONE_NUMBER) missing.push('TWILIO_PHONE_NUMBER');

  if (missing.length > 0) {
    console.error('Missing required environment variables:');
    missing.forEach((v) => console.error(`  - ${v}`));
    console.error('\nCopy .env.example to .env and fill in your values.');
    process.exit(1);
  }

  console.log('Environment validated. Starting setup...\n');

  // Step 1: Create agent
  console.log('─'.repeat(60));
  console.log('STEP 1/3: Creating ElevenLabs Agent');
  console.log('─'.repeat(60));

  let agentId = process.env.ELEVENLABS_AGENT_ID;
  if (agentId) {
    console.log(`Agent already exists (${agentId}), skipping creation.\n`);
  } else {
    agentId = await createAgent();
    // Reload env after agent creation appended the ID
    process.env.ELEVENLABS_AGENT_ID = agentId;
    console.log();
  }

  // Step 2: Connect phone
  console.log('─'.repeat(60));
  console.log('STEP 2/3: Connecting Twilio Phone Number');
  console.log('─'.repeat(60));

  let phoneId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
  if (phoneId) {
    console.log(`Phone already connected (${phoneId}), skipping import.\n`);
  } else {
    phoneId = await connectPhone();
    console.log();
  }

  // Step 3: Deploy widget
  console.log('─'.repeat(60));
  console.log('STEP 3/3: Deploying Widget to Shopify');
  console.log('─'.repeat(60));
  console.log('This step opens a browser for Shopify admin login.\n');

  await deployWidget();

  console.log('\n' + '='.repeat(60));
  console.log('  Setup Complete!');
  console.log('='.repeat(60));
  console.log(`
What's now live:
  ✓ ElevenLabs AI agent (ID: ${agentId})
  ✓ Twilio phone number connected (ID: ${phoneId})
  ✓ Website widget deployed to Shopify theme

Next steps:
  1. Call ${process.env.TWILIO_PHONE_NUMBER} to test phone support
  2. Visit https://www.paintaccess.com.au to test the website widget
  3. Review calls at https://elevenlabs.io/app/agents/history
  4. Fine-tune the agent prompt at https://elevenlabs.io/app/agents
  `);
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
