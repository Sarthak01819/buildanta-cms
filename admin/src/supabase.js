import { createClient } from '@supabase/supabase-js'

// The ANON key, always — never the service key.
//
// The anon key is public by design: it identifies the project, it does not
// grant anything. Every permission in this admin comes from RLS evaluated
// against the signed-in user. Shipping a service key to a browser would hand
// every visitor owner rights and make all 11 policies decoration, which is the
// same failure that shipped on Dhandho v2 in production.
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env.local')
}
if (/service_role/.test(key)) {
  // Cheap, and it catches the one mistake that would matter most.
  throw new Error('That is a SERVICE key. It must never reach a browser — use the anon key.')
}

export const supabase = createClient(url, key)

// Public URL for a stored file. The bucket is public because the site is a
// static build: a signed URL would expire and the built HTML would rot.
export const mediaUrl = (path) =>
  path ? supabase.storage.from('media').getPublicUrl(path).data.publicUrl : null
