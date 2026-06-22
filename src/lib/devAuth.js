// =====================================================================
// DEV-ONLY mock authentication.
//
// Lets you reach the authenticated routes (/play, /profile, /leaderboard,
// game boards) without going through Discord OAuth — handy for local UI work
// and headless QA where you can't complete an interactive OAuth consent.
//
// SAFETY — gated by TWO conditions that must BOTH hold:
//   1. __DEV_SERVER__ — a build-time constant injected by vite.config.js, equal
//      to `command === 'serve'`. It is the literal `true` only under the dev
//      server and the literal `false` in every `vite build`, so this whole
//      block (including the fake identity strings) dead-code-eliminates out of
//      any production bundle. Crucially it is keyed on the Vite COMMAND, not on
//      NODE_ENV — `import.meta.env.DEV` is derived from NODE_ENV, which a stray
//      `NODE_ENV=development` could flip even during `vite build`; the command
//      cannot be smuggled in that way. So this genuinely cannot ship to prod.
//   2. VITE_MOCK_AUTH === '1' — an explicit opt-in. NOTE: this is read from the
//      process env AND any auto-loaded .env file (.env.local, .env.development,
//      …), not just .env.local — so never commit it anywhere. .gitignore
//      ignores all .env.* except .env.example.
//
// To turn it on locally:  add `VITE_MOCK_AUTH=1` to .env.local, restart vite.
// OFF by default.
//
// SCOPE — this is a mock of AUTH only, not of the data layer. It seeds a fake
// session + profile in React state; it does NOT install a Supabase JWT, so the
// live client still talks to Supabase as an ANONYMOUS user. Practical effect:
//   • Routing/UI unlock fully (RequireAuth passes, the app shell renders).
//   • Reads that grant anon SELECT work (leaderboard, presence, public profiles).
//   • Anything needing a real auth.uid() does NOT — creating/joining/playing a
//     match (create_room, make_move, the chess-move Edge Function, etc.) will
//     fail. Exercising real gameplay still needs a real Discord login.
// =====================================================================

export const MOCK_AUTH_ENABLED =
  __DEV_SERVER__ && import.meta.env.VITE_MOCK_AUTH === '1'

// A real-looking uuid so anything that keys on profile.id behaves normally; it
// simply won't correspond to a real Supabase row.
export const MOCK_USER_ID = '00000000-0000-4000-8000-000000000001'

// Shaped like what supabase.auth.getSession() returns (only the fields the app
// reads). `null` when disabled so it tree-shakes away in production.
export const mockSession = MOCK_AUTH_ENABLED
  ? {
      access_token: 'mock-access-token',
      token_type: 'bearer',
      user: {
        id: MOCK_USER_ID,
        email: 'dev_tester@example.test',
        user_metadata: {
          user_name: 'dev_tester',
          global_name: 'Dev Tester',
          avatar_url: null,
        },
      },
    }
  : null

// Shaped like a `profiles` row (id, username, global_name, avatar_url, created_at).
export const mockProfile = MOCK_AUTH_ENABLED
  ? {
      id: MOCK_USER_ID,
      username: 'dev_tester',
      global_name: 'Dev Tester',
      avatar_url: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }
  : null
