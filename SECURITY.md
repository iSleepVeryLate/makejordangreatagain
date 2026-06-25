# Security notes

## "The Supabase URL is showing in the Discord login modal — is that a leak?"

**No.** When you authorize the app, Discord shows:

> redirected outside of Discord to: **https://&lt;project-ref&gt;.supabase.co**

That is the **Supabase project URL** — the OAuth callback endpoint Discord redirects back to after you approve. Discord is *required* to disclose where it sends you, so this URL is inherently public. It is a backend address, **not a credential**.

## What is intentionally public (safe to expose)

| Value | Where it lives | Why it's safe |
|-------|----------------|---------------|
| Project URL (`https://<ref>.supabase.co`) | client bundle, OAuth redirect | It's a public endpoint, like any API base URL. |
| Anon / publishable key (`sb_publishable_…`, `VITE_SUPABASE_ANON_KEY`) | `src/lib/supabaseClient.js`, ships in the browser bundle | Designed to be public. Access is enforced by **Row-Level Security (RLS)**, not by hiding the key. |

These two **must** be in the frontend for the app to talk to Supabase at all. Their security comes from RLS policies on the database — not from secrecy. See Supabase's docs: <https://supabase.com/docs/guides/api/api-keys>.

## What IS secret (never put in the frontend or git)

- **`SUPABASE_SERVICE_ROLE_KEY`** — bypasses RLS. Server-only. It lives in the Edge Function environment (`supabase/functions/chess-move/index.ts` reads it via `Deno.env.get(...)`) and never reaches the client.
- **`.env.local`**, **`.db-conn`**, **`.supabase-token`** — local credentials/tokens. All gitignored. Never commit them. Only `.env.example` (placeholders) is tracked.

## If a key is ever actually leaked

1. Rotate it in **Supabase Dashboard → Project Settings → API**.
2. For the service-role key, redeploy the Edge Function so it picks up the new value.
3. Update `.env.local` (and any deploy environment) with the new anon key.
