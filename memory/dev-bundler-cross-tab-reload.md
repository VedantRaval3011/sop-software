---
name: dev-bundler-cross-tab-reload
description: Why opening a fresh route in dev reloaded all other browser tabs, and the Turbopack fix
metadata:
  type: project
---

Symptom: in `npm run dev`, opening a not-yet-compiled route (e.g. /employees) in one
browser tab triggered a full reload of every OTHER open tab (Dashboard etc.), re-running
all their data fetches.

Root cause: `scripts/dev.mjs` forced `next dev --webpack`. Webpack's dev server compiles
on-demand entries by regenerating a shared runtime chunk; Fast Refresh can't hot-patch that
chunk, so each first-time route compile pushes a full `location.reload()` to all connected
HMR clients. `--webpack` was added incidentally in commit e254c4e, not for compatibility.

Fix (2026-06-30): switched dev to the Next 16 default bundler (Turbopack) by dropping the
`--webpack` arg (override via `DEV_BUNDLER=webpack`). Turbopack compiles routes independently
without invalidating a shared runtime chunk, so a fresh route no longer reloads other tabs.
Verified: app boots on Turbopack and /employees, /training-matrix, /dashboard all render 200
authenticated with no server errors.

Earlier failed attempt: a route-warmup step in dev.mjs (pre-fetch all routes at startup) did
NOT fix it — protected routes were behind next-auth middleware so unauthenticated warmup
fetches only hit the /login redirect and never compiled the real page. Warmup now signs in as
the seeded admin first; it remains as a first-nav latency optimization but is not the fix.

The `onDemandEntries` block in next.config.ts is webpack-only and is now dead config under
Turbopack (harmless; can be removed).
