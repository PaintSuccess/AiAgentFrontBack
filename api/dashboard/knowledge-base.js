/**
 * /api/dashboard/knowledge-base
 * CRUD proxy for ElevenLabs Knowledge Base documents.
 *
 * GET    — list all KB documents for the agent
 * POST   — create a new text document
 * PATCH  — update an existing document (query: ?id=xxx)
 * DELETE — delete a document (query: ?id=xxx)
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");

const ELEVENLABS_API_KEY = (process.env.ELEVENLABS_API_KEY || "").trim();
const ELEVENLABS_AGENT_ID = (process.env.ELEVENLABS_AGENT_ID || "").trim();
const BASE = "https://api.elevenlabs.io/v1";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const session = requireDashboardAuth(req, res);
  if (!session) return;

  const headers = { "xi-api-key": ELEVENLABS_API_KEY };

  try {
    // ── LIST ──
    if (req.method === "GET") {
      // Get the agent to read its knowledge_base config
      const agentRes = await fetch(`${BASE}/convai/agents/${ELEVENLABS_AGENT_ID}`, { headers });
      if (!agentRes.ok) {
        return res.status(502).json({ error: "Failed to fetch agent config" });
      }
      const agent = await agentRes.json();
      const kbDocs = agent.conversation_config?.agent?.prompt?.knowledge_base || [];

      // Fetch each document's content in parallel
      const details = await Promise.allSettled(
        kbDocs.map((doc) =>
          fetch(`${BASE}/convai/knowledge-base/${doc.id}`, { headers })
            .then((r) => (r.ok ? r.json() : null))
        )
      );

      const items = kbDocs.map((doc, i) => {
        const detail = details[i]?.value || null;
        return {
          id: doc.id,
          name: doc.name || detail?.name || "Untitled",
          type: doc.type || "text",
          usage_mode: doc.usage_mode || "auto",
          content: detail?.extracted_inner_html || detail?.content || "",
          dependent_agents: detail?.dependent_agents || [],
        };
      });

      return res.status(200).json({ items });
    }

    // ── CREATE ──
    if (req.method === "POST") {
      const { name, content, usage_mode } = req.body || {};
      if (!name || !content) {
        return res.status(400).json({ error: "name and content are required" });
      }

      // 1. Create the document
      const createRes = await fetch(`${BASE}/convai/knowledge-base/text`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.slice(0, 200),
          text: content.slice(0, 100000),
        }),
      });

      if (!createRes.ok) {
        const text = await createRes.text();
        console.error("KB create error:", createRes.status, text);
        return res.status(502).json({ error: `Failed to create document: ${text.slice(0, 200)}` });
      }

      const created = await createRes.json();
      const newDocId = created.id;

      // 2. Attach to agent
      const attachErr = await attachDocToAgent(newDocId, name, usage_mode || "auto", headers);
      if (attachErr) {
        return res.status(502).json({ error: attachErr });
      }

      return res.status(201).json({ id: newDocId, name, usage_mode: usage_mode || "auto" });
    }

    // ── UPDATE ──
    if (req.method === "PATCH") {
      const docId = req.query.id;
      if (!docId) {
        return res.status(400).json({ error: "Document id is required (?id=xxx)" });
      }

      const { name, content, usage_mode } = req.body || {};

      // Update document content if provided
      if (name || content) {
        const updateBody = {};
        if (name) updateBody.name = name.slice(0, 200);
        if (content) updateBody.text = content.slice(0, 100000);

        // Delete and recreate the document (ElevenLabs text docs don't support PATCH content)
        // First, get current doc info
        const currentRes = await fetch(`${BASE}/convai/knowledge-base/${docId}`, { headers });
        const current = currentRes.ok ? await currentRes.json() : null;

        const finalName = name || current?.name || "Untitled";
        const finalContent = content || current?.extracted_inner_html || current?.content || "";
        const finalMode = usage_mode || "auto";

        // Delete old doc
        await fetch(`${BASE}/convai/knowledge-base/${docId}`, {
          method: "DELETE",
          headers,
        });

        // Create new doc
        const createRes = await fetch(`${BASE}/convai/knowledge-base/text`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: finalName,
            text: finalContent,
          }),
        });

        if (!createRes.ok) {
          const errText = await createRes.text();
          console.error("KB recreate error:", createRes.status, errText);
          return res.status(502).json({ error: `Failed to recreate document: ${errText.slice(0, 200)}` });
        }

        const created = await createRes.json();

        // Remove old doc from agent and add new one
        const detachErr = await replaceDocOnAgent(docId, created.id, finalName, finalMode, headers);
        if (detachErr) {
          return res.status(502).json({ error: detachErr });
        }

        return res.status(200).json({ id: created.id, name: finalName, usage_mode: finalMode });
      }

      // Only usage_mode changed — update agent config
      if (usage_mode) {
        const modeErr = await updateDocModeOnAgent(docId, usage_mode, headers);
        if (modeErr) {
          return res.status(502).json({ error: modeErr });
        }
        return res.status(200).json({ id: docId, usage_mode });
      }

      return res.status(400).json({ error: "Nothing to update" });
    }

    // ── DELETE ──
    if (req.method === "DELETE") {
      const docId = req.query.id;
      if (!docId) {
        return res.status(400).json({ error: "Document id is required (?id=xxx)" });
      }

      // Remove from agent first
      const detachErr = await detachDocFromAgent(docId, headers);
      if (detachErr) {
        console.error("Detach warning:", detachErr);
      }

      // Delete the document
      const delRes = await fetch(`${BASE}/convai/knowledge-base/${docId}`, {
        method: "DELETE",
        headers,
      });

      if (!delRes.ok && delRes.status !== 404) {
        return res.status(502).json({ error: "Failed to delete document" });
      }

      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Knowledge base API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── Helper: get current agent KB config ──
async function getAgentKB(headers) {
  const r = await fetch(`${BASE}/convai/agents/${ELEVENLABS_AGENT_ID}`, { headers });
  if (!r.ok) return null;
  const agent = await r.json();
  return {
    knowledge_base: agent.conversation_config?.agent?.prompt?.knowledge_base || [],
    rag: agent.conversation_config?.agent?.prompt?.rag || {},
  };
}

// ── Helper: patch agent KB config ──
async function patchAgentKB(knowledge_base, rag, headers) {
  const body = {
    conversation_config: {
      agent: {
        prompt: {
          knowledge_base,
          rag,
        },
      },
    },
  };

  const r = await fetch(`${BASE}/convai/agents/${ELEVENLABS_AGENT_ID}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const text = await r.text();
    console.error("Agent KB patch error:", r.status, text);
    return "Failed to update agent config";
  }
  return null;
}

// ── Attach a new doc to agent ──
async function attachDocToAgent(docId, name, usageMode, headers) {
  const config = await getAgentKB(headers);
  if (!config) return "Failed to read agent config";

  const kb = [...config.knowledge_base, { type: "text", id: docId, name, usage_mode: usageMode }];
  return patchAgentKB(kb, config.rag, headers);
}

// ── Replace doc on agent (delete old + add new) ──
async function replaceDocOnAgent(oldId, newId, name, usageMode, headers) {
  const config = await getAgentKB(headers);
  if (!config) return "Failed to read agent config";

  const kb = config.knowledge_base.filter((d) => d.id !== oldId);
  kb.push({ type: "text", id: newId, name, usage_mode: usageMode });
  return patchAgentKB(kb, config.rag, headers);
}

// ── Update usage_mode for a doc on agent ──
async function updateDocModeOnAgent(docId, usageMode, headers) {
  const config = await getAgentKB(headers);
  if (!config) return "Failed to read agent config";

  const kb = config.knowledge_base.map((d) =>
    d.id === docId ? { ...d, usage_mode: usageMode } : d
  );
  return patchAgentKB(kb, config.rag, headers);
}

// ── Detach a doc from agent ──
async function detachDocFromAgent(docId, headers) {
  const config = await getAgentKB(headers);
  if (!config) return "Failed to read agent config";

  const kb = config.knowledge_base.filter((d) => d.id !== docId);
  return patchAgentKB(kb, config.rag, headers);
}
