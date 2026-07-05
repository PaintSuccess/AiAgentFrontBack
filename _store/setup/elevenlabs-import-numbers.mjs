// Import BOTH new numbers into ElevenLabs and assign agent.
//   - Sydney landline (+61 2 5838 5959) → voice agent
//   - Mobile (+61 485 077 888) → SMS/outbound (still useful for ElevenLabs voice too)
// Writes IDs back to app/.env and setup/.env

import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_BASE = 'https://api.elevenlabs.io/v1';

const NUMBERS = [
  {
    key: 'TWILIO_SYDNEY_NUMBER',
    phone: '+61258385959',
    label: 'Paint Access Sydney Line',
    envKey: 'ELEVENLABS_PHONE_NUMBER_ID_SYDNEY',
  },
  {
    key: 'TWILIO_MOBILE_NUMBER',
    phone: '+61485077888',
    label: 'Paint Access Mobile',
    envKey: 'ELEVENLABS_PHONE_NUMBER_ID_MOBILE',
  },
];

const apiKey = process.env.ELEVENLABS_API_KEY;
const twilioSid = process.env.TWILIO_ACCOUNT_SID;
const twilioToken = process.env.TWILIO_AUTH_TOKEN;
const agentId = process.env.ELEVENLABS_AGENT_ID;

if (!apiKey || !twilioSid || !twilioToken || !agentId) {
  console.error('Missing env vars: ELEVENLABS_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, ELEVENLABS_AGENT_ID');
  process.exit(1);
}

// Check existing ElevenLabs phone numbers to avoid duplicate import
const listRes = await fetch(`${API_BASE}/convai/phone-numbers?page_size=20`, {
  headers: { 'xi-api-key': apiKey },
});
const listData = await listRes.json();
const existing = Array.isArray(listData.phone_numbers) ? listData.phone_numbers : (listData.items || []);
console.log('Existing ElevenLabs phone numbers:');
for (const n of existing) console.log(` ${n.phone_number_id} | ${n.phone_number} | ${n.label}`);

function updateEnvFile(filePath, key, value) {
  let content = '';
  try { content = readFileSync(filePath, 'utf8'); } catch (_) {}
  if (content.includes(`${key}=`)) {
    content = content.replace(new RegExp(`${key}=.*`), `${key}=${value}`);
  } else {
    content += `\n${key}=${value}\n`;
  }
  writeFileSync(filePath, content);
}

const envPaths = [join(__dirname, '.env'), join(__dirname, '..', '..', '.env')];

for (const num of NUMBERS) {
  console.log(`\n--- ${num.label} (${num.phone}) ---`);

  // Check if already imported
  const found = existing.find((n) => n.phone_number?.replace(/\s/g, '') === num.phone.replace(/\s/g, ''));
  if (found) {
    console.log(`Already imported: ${found.phone_number_id}`);
    for (const p of envPaths) updateEnvFile(p, num.envKey, found.phone_number_id);
    // Ensure agent is assigned
    const patch = await fetch(`${API_BASE}/convai/phone-numbers/${found.phone_number_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
      body: JSON.stringify({ agent_id: agentId }),
    });
    const pData = await patch.json();
    console.log(`Agent assigned: ${patch.status} — ${JSON.stringify(pData).slice(0, 120)}`);
    continue;
  }

  // Import
  const importRes = await fetch(`${API_BASE}/convai/phone-numbers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({
      provider: 'twilio',
      label: num.label,
      phone_number: num.phone,
      sid: twilioSid,
      token: twilioToken,
    }),
  });
  const importData = await importRes.json();
  if (!importRes.ok) {
    console.error(`Import failed (${importRes.status}):`, JSON.stringify(importData));
    continue;
  }
  const phoneNumberId = importData.phone_number_id;
  console.log(`Imported! ID: ${phoneNumberId}`);

  // Assign agent
  const patchRes = await fetch(`${API_BASE}/convai/phone-numbers/${phoneNumberId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({ agent_id: agentId }),
  });
  const patchData = await patchRes.json();
  console.log(`Agent assigned: ${patchRes.status} — ${JSON.stringify(patchData).slice(0, 120)}`);

  for (const p of envPaths) updateEnvFile(p, num.envKey, phoneNumberId);
}

console.log('\nDone. IDs written to .env files.');
