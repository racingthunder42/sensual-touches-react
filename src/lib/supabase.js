import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const initialAuthFlowType = new URLSearchParams(
  window.location.hash.slice(1),
).get("type");

export const isPasswordRecoveryLink =
  initialAuthFlowType === "recovery" ||
  new URLSearchParams(window.location.search).get("reset") === "1";

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;

export const isSupabaseConfigured = Boolean(supabase);
