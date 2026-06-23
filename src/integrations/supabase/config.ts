const DEFAULT_SUPABASE_PROJECT_ID = "aoikjmfwespkuafemzjc";
const DEFAULT_SUPABASE_URL = `https://${DEFAULT_SUPABASE_PROJECT_ID}.supabase.co`;
const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_xtsrS1O2HPSCXuU_iKykfA_oi4ZBESp";

export const SUPABASE_PROJECT_ID =
  import.meta.env.VITE_SUPABASE_PROJECT_ID?.trim() ||
  DEFAULT_SUPABASE_PROJECT_ID;

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL;

export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  DEFAULT_SUPABASE_PUBLISHABLE_KEY;
