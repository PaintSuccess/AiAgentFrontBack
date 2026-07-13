/** Quick replies / canned responses (CRUD). */
const { getSupabase } = require("../supabase");

async function listCanned() {
  const sb = getSupabase();
  if (!sb) return { items: [] };
  const { data } = await sb.from("canned_responses").select("*").order("title", { ascending: true });
  return { items: data || [] };
}

async function createCanned({ title, body, channel }) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("canned_responses")
    .insert({ title: String(title).slice(0, 120), body: String(body).slice(0, 1500), channel: channel || null })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function deleteCanned(id) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("canned_responses").delete().eq("id", id);
}

module.exports = { listCanned, createCanned, deleteCanned };
