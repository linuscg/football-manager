# Football Manager — Film Production Management

React 19 + Vite SPA, Supabase backend (Postgres + RLS + edge functions), Vercel
auto-deploys from `main` (live at footballmanager.xyz). Despite the name this is
a film production tool: scheduling, crew gantt, cost tracking, call sheets,
timesheets, accommodation, catering, DPRs, deal memos.

## Commands

- `npm run dev -- --port 7890` — dev server (or use `.claude/launch.json`
  preview config `production-manager`)
- `npm run build` — always build before committing; pushes to `main` deploy to
  production immediately via Vercel
- Supabase CLI (project is linked): `supabase db query --linked "SQL"` or
  `--file path.sql` runs SQL directly; `supabase functions deploy <name>`
  deploys an edge function. Save every applied migration as a file under
  `supabase/migrations/` (they are documentation — the CLI applies them, the
  folder is not auto-synced).
- After DDL, run `notify pgrst, 'reload schema';` so PostgREST sees new
  tables/columns.

## Architecture rules (hard-won — do not regress)

- **Supabase silently caps reads at 1,000 rows.** Any query that can exceed it
  uses a paged `.range()` loop (see `useCrewStore.loadAll`). New big tables
  must do the same.
- **Every store `loadAll` carries a `loadGenRef` guard** so a slow fetch for
  the previous production never lands after a production switch. Copy the
  pattern for new stores.
- **Realtime channels need unique per-instance topics**
  (`` `name_${crypto.randomUUID()}` ``) — two components joining one fixed
  topic silently breaks one of them.
- **Gantt painting never touches React state mid-drag**: cells get direct DOM
  class feedback, ops accumulate in a ref, and mouse-up commits once via
  `applyPaintOps` (≤3 bulk DB requests). Fulltime crew: hire dates drive
  bookings (auto weekday fill, `fulltimeBookingSync`); additional crew:
  painting drives hire dates. Never create a feedback loop between the two.
- **Money fields live in `resource_rates`, not `resources`** — RLS withholds
  that table from members flagged `denyCrewRates` (owners bypass). New rate
  fields go there; the store merges them via the embedded
  `resource_rates(*)` select.
- **Per-user permissions are server-enforced**: `production_members.permissions`
  jsonb ({deniedTabs, deniedModules, denyCrewRates}) drives both the UI
  (`App.jsx` effTopTab/effModule) and RESTRICTIVE RLS policies via
  `member_can_access(prod, tab, module)` / `member_can_see_rates(prod)`.
  A new module with its own tables needs a restrictive policy; shared tables
  stay membership-scoped. The registry is `src/lib/permissionRegistry.js` and
  must stay in sync with `App.jsx` nav ids.
- **Tenant isolation**: membership comes only from the production-creation
  trigger, admin inserts, or the `accept_invite()` RPC. Invites are read via
  `get_invite_by_token()`. `profiles.is_owner` (the app owner) is protected by
  a DB trigger. Never add permissive policies on `production_members`,
  `invites`, or `profiles` without thinking hard.
- **Rates engine** (`src/lib/rateCalc.js`): weekly gross is the source;
  net = gross ÷ 1.1207 (holiday factor), daily = weekly ÷ 5, hourly = daily ÷ 11,
  6th day 1.5×, 7th 2×, OT 1.5× hourly — per-row overrides in
  sixth_day_rate/seventh_day_rate/ot_rate (null = formula). Production-level
  settings in `production.rate_calc` jsonb.
- **Popovers inside scrolling containers must be `position: fixed`** anchored
  to the trigger, or they clip (recurring bug).
- **Email sending** goes through the `send-welcome-email` /`send-invite` edge
  functions (Resend, caller must be owner/admin, recipients must be crew
  contact emails of the production, matched case-insensitively).
- **Deal memos** (`src/lib/dealMemo.js` + New Starters tab): Tax Status
  "Loan Out" → loan-out template, else direct hire. Word docs fill via
  docxtemplater from `public/deal-memo/*.docx`; the sent PDF fills
  `public/deal-memo/*-base.pdf` at coordinates in
  `src/lib/dealMemoPdfMap.json`. The bases are pre-rendered with LibreOffice
  from the tagged Word docs — if the templates or the production's phase dates
  change, the bases and map must be regenerated together. Templates are
  production-specific (currently MOLEPEOPLE).

## Testing & safety

- Verify changes in the browser preview before pushing; `main` is production.
- **Never send test emails to real crew members** — only to your own address.
  Crew emails in the tracker are real people.
- The `resources`/`resource_bookings` data in Supabase is live production
  data; clean up any test rows you create.
- Two test productions exist for experiments: "Example Production" and
  "Matilda's Test Production". Prefer them over real ones.

## Conventions

- Plain React hooks as stores (`src/store/*.js`), one instance per consumer,
  optimistic updates with error-checked writes (`dbWrite` pattern, reload on
  failure). No external state library.
- Styling is a single `src/styles/global.css` with BEM-ish class prefixes per
  module (`.budget-*`, `.ns-*`, `.gantt-*`, `.admin-*`).
- Department ordering app-wide: Producers/Executives → Directors → Production
  → rest alphabetical (`deptPriority`).
- Dates are `YYYY-MM-DD` strings in state/DB; parse with `new Date(s + 'T00:00:00')`
  to avoid UTC midnight shifts.
