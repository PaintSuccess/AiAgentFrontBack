// create-agent.js — Creates an ElevenLabs Conversational AI agent for Paint Access
import 'dotenv/config';
import { readFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_BASE = 'https://api.elevenlabs.io/v1';

const SYSTEM_PROMPT = `You are a friendly and knowledgeable customer support assistant for Paint Access (paintaccess.com.au), Australia's leading online paint and painting equipment store.

Your role:
- Help customers find the right products (paint sprayers, rollers, masking tape, surface prep tools, protection gear, accessories, paint)
- Answer questions about product availability, specifications, and pricing
- Provide basic painting advice and tips
- Help with order status inquiries
- Guide customers to relevant pages on the website
- Assist trade/VIP customers with discount information

Key business info:
- Phone: 028-064-70-50
- SMS: +61410609617
- Email: trade@PaintAccess.com.au
- Website: paintaccess.com.au
- Location: Australia-wide shipping
- Brands: Graco, Mirka, iQuip, Taubmans, ZipWall, Oldfields, Uni-Pro, Dulux, PPG, Rust-Oleum, Zinsser, and 50+ more
- Services: Paint sprayer hire, service & repairs, VIP painters community, trade discounts (7% for tradies)
- Free shipping on orders over certain thresholds

Guidelines:
- Be warm, Australian-friendly, and professional
- Keep answers concise — 1-3 sentences unless the customer asks for detail
- If you don't know something specific (like exact stock levels), direct them to call 028-064-70-50 or email trade@PaintAccess.com.au
- For technical painting questions, provide general advice and suggest checking the Painting Guides section
- Never make up product prices or stock information
- For order tracking, ask for their order number and direct them to check their email or contact support`;

const FIRST_MESSAGE = "G'day! Welcome to Paint Access. I can help you find the right painting gear, answer product questions, or assist with your order. What can I help you with?";

async function createAgent() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('Error: ELEVENLABS_API_KEY not set in .env');
    process.exit(1);
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel

  console.log('Creating ElevenLabs agent for Paint Access...');

  const body = {
    name: 'Paint Access Support',
    conversation_config: {
      agent: {
        prompt: {
          prompt: SYSTEM_PROMPT,
        },
        first_message: FIRST_MESSAGE,
        language: 'en',
      },
      tts: {
        voice_id: voiceId,
      },
    },
  };

  const res = await fetch(`${API_BASE}/convai/agents/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`ElevenLabs API error (${res.status}):`, text);
    process.exit(1);
  }

  const data = await res.json();
  const agentId = data.agent_id;
  console.log(`Agent created successfully! ID: ${agentId}`);

  // Add website URL as knowledge source
  console.log('Adding Paint Access website as knowledge source...');
  await addKnowledgeUrl(apiKey, agentId, 'https://www.paintaccess.com.au/', 'Paint Access Homepage');
  await addKnowledgeUrl(apiKey, agentId, 'https://www.paintaccess.com.au/pages/frequently-asked-questions', 'Paint Access FAQ');
  await addKnowledgeUrl(apiKey, agentId, 'https://www.paintaccess.com.au/pages/painting-guides-redesign', 'Painting Guides');

  // Upload the knowledge base markdown file
  const kbPath = join(__dirname, 'knowledge-base.md');
  try {
    const kbContent = await readFile(kbPath, 'utf8');
    console.log('Uploading knowledge base document...');
    await addKnowledgeDocument(apiKey, agentId, kbContent);
  } catch {
    console.log('No knowledge-base.md found, skipping document upload (website URLs added).');
  }

  // Save agent ID to .env
  const envPath = join(__dirname, '.env');
  await appendFile(envPath, `\nELEVENLABS_AGENT_ID=${agentId}\n`);
  console.log(`Agent ID saved to .env: ${agentId}`);

  return agentId;
}

async function addKnowledgeUrl(apiKey, agentId, url, name) {
  try {
    const res = await fetch(`${API_BASE}/convai/agents/${agentId}/add-to-knowledge-base`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({ url, name }),
    });
    if (res.ok) {
      console.log(`  + Added URL: ${url}`);
    } else {
      const text = await res.text();
      console.warn(`  ! Could not add URL ${url}: ${text}`);
    }
  } catch (err) {
    console.warn(`  ! Failed to add URL ${url}:`, err.message);
  }
}

async function addKnowledgeDocument(apiKey, agentId, content) {
  try {
    const formData = new FormData();
    const blob = new Blob([content], { type: 'text/markdown' });
    formData.append('file', blob, 'paint-access-knowledge-base.md');

    const res = await fetch(`${API_BASE}/convai/agents/${agentId}/add-to-knowledge-base`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
      },
      body: formData,
    });
    if (res.ok) {
      console.log('  + Uploaded knowledge base document');
    } else {
      const text = await res.text();
      console.warn(`  ! Could not upload document: ${text}`);
    }
  } catch (err) {
    console.warn('  ! Failed to upload document:', err.message);
  }
}

// Run if called directly
const isMain = process.argv[1] && fileURLToPath(import.meta.url).includes(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain || process.argv[1]?.endsWith('create-agent.js')) {
  createAgent().catch(console.error);
}

export { createAgent };
