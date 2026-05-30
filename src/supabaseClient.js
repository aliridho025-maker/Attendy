import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// true jika kedua env var sudah diisi (di .env lokal atau di Vercel)
export const configured = Boolean(url && key);

export const supabase = configured ? createClient(url, key) : null;
