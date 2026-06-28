import { createClient } from "@supabase/supabase-js";

// ── Setup ────────────────────────────────────────────────────────────────────
// 1. Create a free project at https://supabase.com
// 2. In the SQL editor, run:
//
//    create table kv_store (
//      key text primary key,
//      value text not null,
//      shared boolean not null default false,
//      updated_at timestamptz not null default now()
//    );
//    alter table kv_store enable row level security;
//    create policy "public read/write" on kv_store for all using (true) with check (true);
//
// 3. Copy your Project URL and anon public key from Settings > API
// 4. Create a `.env` file in the project root (see .env.example) with:
//      VITE_SUPABASE_URL=https://xxxx.supabase.co
//      VITE_SUPABASE_ANON_KEY=eyJ...
//
// The RLS policy above allows anyone to read/write — fine for a small shared
// fan-tracker app. Tighten it later if you want auth-gated saves.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function ensureConfigured() {
  if (!supabase) {
    throw new Error(
      "Supabase isn't configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file (see .env.example) and to your Vercel/Netlify project's Environment Variables."
    );
  }
}

// Personal saves are namespaced per-browser using a random local device id,
// since there's no login system. Shared saves (the Cloud Saves feature) use
// the raw key so everyone sees the same rows.
function deviceId() {
  let id = localStorage.getItem("wwe2k26_device_id");
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("wwe2k26_device_id", id);
  }
  return id;
}

function scopedKey(key, shared) {
  return shared ? key : `${deviceId()}::${key}`;
}

// ── window.storage-compatible API ─────────────────────────────────────────────
export const storage = {
  async get(key, shared = false) {
    ensureConfigured();
    const fullKey = scopedKey(key, shared);
    const { data, error } = await supabase
      .from("kv_store")
      .select("key, value, shared")
      .eq("key", fullKey)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { key, value: data.value, shared };
  },

  async set(key, value, shared = false) {
    ensureConfigured();
    const fullKey = scopedKey(key, shared);
    const { error } = await supabase
      .from("kv_store")
      .upsert({ key: fullKey, value: String(value), shared, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw error;
    return { key, value, shared };
  },

  async delete(key, shared = false) {
    ensureConfigured();
    const fullKey = scopedKey(key, shared);
    const { error } = await supabase.from("kv_store").delete().eq("key", fullKey);
    if (error) throw error;
    return { key, deleted: true, shared };
  },

  async list(prefix = "", shared = false) {
    ensureConfigured();
    if (shared) {
      const { data, error } = await supabase
        .from("kv_store")
        .select("key")
        .eq("shared", true)
        .like("key", `${prefix}%`);
      if (error) throw error;
      return { keys: (data || []).map((r) => r.key), prefix, shared };
    } else {
      const dPrefix = `${deviceId()}::${prefix}`;
      const { data, error } = await supabase
        .from("kv_store")
        .select("key")
        .eq("shared", false)
        .like("key", `${dPrefix}%`);
      if (error) throw error;
      const keys = (data || []).map((r) => r.key.replace(`${deviceId()}::`, ""));
      return { keys, prefix, shared };
    }
  },
};

export const isSupabaseConfigured = !!supabase;
