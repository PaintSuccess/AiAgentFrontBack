// connect-phone.js — Imports Twilio phone number into ElevenLabs and assigns agent
import 'dotenv/config';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_BASE = 'https://api.elevenlabs.io/v1';

async function connectPhone() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
  const agentId = process.env.ELEVENLABS_AGENT_ID;

  if (!apiKey || !twilioSid || !twilioToken || !phoneNumber) {
    console.error('Error: Missing required env vars. Need ELEVENLABS_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER');
    process.exit(1);
  }

  if (!agentId) {
    console.error('Error: ELEVENLABS_AGENT_ID not set. Run create-agent.js first.');
    process.exit(1);
  }

  // Step 1: Import the Twilio phone number into ElevenLabs
  console.log(`Importing Twilio number ${phoneNumber} into ElevenLabs...`);

  const importRes = await fetch(`${API_BASE}/convai/phone-numbers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      provider: 'twilio',
      label: 'Paint Access Support Line',
      phone_number: phoneNumber,
      sid: twilioSid,
      token: twilioToken,
    }),
  });

  if (!importRes.ok) {
    const text = await importRes.text();
    console.error(`Failed to import phone number (${importRes.status}):`, text);
    process.exit(1);
  }

  const importData = await importRes.json();
  const phoneNumberId = importData.phone_number_id;
  console.log(`Phone number imported! ID: ${phoneNumberId}`);

  // Step 2: Assign the agent to handle calls on this number
  console.log(`Assigning agent ${agentId} to phone number...`);

  const assignRes = await fetch(`${API_BASE}/convai/phone-numbers/${phoneNumberId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      agent_id: agentId,
    }),
  });

  if (!assignRes.ok) {
    const text = await assignRes.text();
    console.error(`Failed to assign agent (${assignRes.status}):`, text);
    process.exit(1);
  }

  const assignData = await assignRes.json();
  console.log('Agent assigned to phone number successfully!');
  console.log(`  Phone: ${assignData.phone_number || phoneNumber}`);
  console.log(`  Agent: ${assignData.assigned_agent?.agent_name || agentId}`);

  // Save phone number ID to .env
  const envPath = join(__dirname, '.env');
  await appendFile(envPath, `\nELEVENLABS_PHONE_NUMBER_ID=${phoneNumberId}\n`);
  console.log(`Phone number ID saved to .env: ${phoneNumberId}`);

  return phoneNumberId;
}

// Run if called directly
if (process.argv[1]?.endsWith('connect-phone.js')) {
  connectPhone().catch(console.error);
}

export { connectPhone };
