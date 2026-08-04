# SnoMaster Field Sales Portal — Current State

## Project Location
`C:\Users\CarlDosSantos-(OUTER\Projects\snomaster-fieldsales-portal`
GitHub: [snomaster-fieldsales-portal](https://github.com/CarlofSaints/snomaster-fieldsales-portal)
Vercel: **https://vercel.com/carl-dos-santos-projects/snomaster-fieldsales-portal** — LIVE, auto-deploys from GitHub on push to `main` (Git integration; no `.vercel` CLI link, no manual `vercel --prod`).

## Origin
Cloned from **Haier BA Measurement** (`haier-ba-measurement`) on 2026-06-29. Same codebase/feature set,
rebranded for SnoMaster. **No Haier data was copied** — all data lives in Vercel Blob, so the new
deployment gets its own isolated Blob store. The seed route creates only the super-admin login
(`carl@outerjoin.co.za`).

## Branding
- Primary red **#e31e1c** (SnoMaster red); hover **#b81816**; accent **#f5453f** / hover **#e0322e**.
- CSS vars renamed `--haier-*` → `--sno-*` in `app/globals.css`.
- Logo: `public/snomaster-logo.png` (converted from `SNOMASTER_LOGO_FA.webp`, transparent). Used in
  sidebar + login + reset pages. Login/reset background image removed (solid red + gradient overlay).
- localStorage keys `haier_*` → `snomaster_*`; seed secret `snomaster-seed-2026`; seed pw `snomaster2026`.
- Agency footer "An Atomic Marketing Initiative" (+ atomic-logo.png, oj-logo.png) kept as-is.

## Tech Stack
- Next.js 16, React 19, TypeScript, Tailwind CSS 4
- Vercel Blob storage (JSON), bcryptjs auth, Recharts, html-to-image, Resend email, xlsx
- Roles: super_admin, admin, client

## What The App Does
BA (Brand Ambassador) performance scoring dashboard. 6 KPIs out of 100 core + 10 bonus = 110.
Data uploaded via Excel (visits, training, display checks, red flags, sales DISPO, targets). Some
KPIs auto-calculate, admins manually score the rest. (See git history / the Haier project for the
full scoring + report architecture — identical code.)

## Default Sales Channels
`lib/channelData.ts` defaults set to SnoMaster's retailers: **MASSMART → MAKRO** (sub) and **HIRSCH'S**.
(Editable in Control Centre → Sales Channels.)

## Retailer Data Sources
- **Makro** — standard **DISPO** Excel uploads (existing `app/api/dispo/upload/route.ts`, dynamic header
  scanning + latest-month detection). KEPT unchanged.
- **Hirsch's** — messy period-sum `.xls` exports ("Sales & Stock by Supplier"), NOT DISPOs.
  **PARSER + INGESTION BUILT** (2026-06-30). Layout: split title/date block, header row
  `Code|D|Cat|Description|Br|Sales Qty|Sales Val|Stock Qty|Stock Val`, category divider rows + a
  Grand Totals footer interleaved. `lib/hirschParse.ts` keeps only rows whose description contains
  SNOMASTER (model code = first token, stripped), parses the From/To range (DD/MM/YYYY, spaces),
  parses comma Rand strings. `lib/hirschData.ts` stores by **period** (files must be within ONE month;
  sales summed per month, stock = latest period in month). **Overlap blocked** at upload with a popup
  (data is a period sum, can't de-overlap). Routes `/api/hirsch/upload|GET|delete/[id]`; upload UI
  section on `/upload`. Validated vs the sample file (per-branch totals == file's Grand Totals ±R1).
  **Site-file upload DONE** (`lib/siteFileData.ts`, `/api/site-file`): Makro + Hirsch `MASTER_SITE`
  files name stores by code (Makro drops MASSBUILD; Hirsch keeps all). Stores page shows resolved names.
  **Phase B DONE** (2026-06-30): Hirsch sales wired into scoring + leaderboard. On upload, branches are
  linked into the store master (named via site file) + sales recalculated. Sales KPI now: targeted
  stores score vs target (Makro, unchanged); **untargeted stores (Hirsch, and any Makro w/o a target)
  score vs PREVIOUS MONTH's actual** (no targets loaded yet → everything is prev-month-based for now;
  add targets later to switch those stores to target-based). Leaderboard salesVal/Vol = Makro + Hirsch
  combined. ⚠ NEEDS LIVE VERIFICATION with real visits+sales+linked stores.

## Store Master = Canonical Hub (2026-06-30 rework)
The store master (`admin/stores.json`, `lib/storeData.ts`) is now the single source of truth, keyed by
the **Perigee (visit) code**. Previously stores only existed if sales/DISPO data was loaded, and a
visit's Perigee `storeCode` only matched the retailer's sales code by coincidence — that disconnect is
the bug behind wrong store↔BA attribution.
- **StoreMaster** now has `perigeeCode`, `salesName`, `salesCode`, `notInData`, `source` (+ legacy
  `siteCode` kept for migration). `normalizeStore()` migrates old DISPO rows to `source:'sales'`.
- **Visited stores auto-upsert** into the master on every visit poll (manual + cron) and manual upload
  (`syncVisitedStores`/`upsertVisitedStores`).
- **Sales loads link** to the master (`linkSalesStores`): match by sales code → sales name →
  Perigee==sales code → name; unmatched become orphan `source:'sales'` rows.
- **Attribution resolvers** (`buildCodeToSalesName`, `buildAssignmentByCode`) map ANY code
  (Perigee/sales/legacy) → sales name, used by leaderboard, autoCalc, auto-calc-sales, guidance,
  ba-work, and the sales page — so visits and sales feeds "talk to each other".
- **Stores page** (`/admin/stores`): tabs (All / Needs linking / Sales w/o store / Not in data /
  Linked), a search-and-link modal (merge a visited store with a sales entry, both directions), and a
  per-store **"Not in data"** toggle for visited stores with no sales feed (Beares, Dial-a-bed).
- **Leaderboard display store** is now a BA's **most-visited** store (assignment still overrides),
  replacing the old arbitrary "last visit row wins" behaviour.

### Diagnostic
`/api/debug/ba-store?q=<email|name>` (admin-only, read-only) dumps every visit row for a BA, which store
the leaderboard resolves, and any store-master assignment — built to pin down the Josephe Gwabeni
mis-attribution (store shown ≠ stores actually visited). **Still to confirm with live data** whether his
case was stale/cross-month visits, an email collision, or an assignment.

## Call Cycles module (2026-08-04)

Ported from the **iRAM Perigee Call Cycle Builder** (`~/Projects/perigee-callcycle-builder`, live at
`iram.callcycle.fieldgoose.outerjoin.co.za`). Same job: managers send call cycles as Excel in whatever
shape they like, we parse them into rep/store/day rows, and export a **Perigee-ready workbook** that
uploads straight into the Perigee portal.

**Key difference from iRAM: SnoMaster is single-tenant** — every loader lost its `tenantSlug`
parameter, and storage moved onto SnoMaster's own `lib/blob.ts` (`readJson`/`writeJson`) instead of
raw `@vercel/blob` + local-file fallbacks.

### Files
- `lib/callcycle/types.ts` — `ScheduleRow`, `ParsedEntry`, `ReferenceData`, control-file shapes.
  `ReferenceData.storeSource` is new (`'control' | 'store-master' | 'none'`) so the UI can warn.
- `lib/callcycle/parsers/` — **copied verbatim** (8 files). Format-agnostic Excel shape readers:
  `parse4Week` (user-4wk), `parseMarkerFormat` (team-leader), `parseEmailSheet` (user),
  plus `parseJoshStandard` / `parseJoshAlt` / `parseAshFormat` / `parseSimpleName` on the legacy
  auto-detect path. `parserUtils.extractStoreCode()` handles `NAME - CODE`, `NAME [CODE]`,
  `NAME-CODE`, `NAME CODE` and de-duplicates a trailing code out of the name.
- `lib/callcycle/storeChannelResolver.ts` — copied verbatim. **A Perigee site code is only unique
  WITHIN a channel**, so duplicate codes are disambiguated by store name (exact → channel keyword →
  single best token overlap → ambiguous). Ambiguous = "error site".
- `lib/callcycle/scheduleData.ts` — merge engine. `teamLeader` is a READ-TIME join off the team
  control file and is stripped before every write, so it never goes stale on disk.
- `lib/callcycle/referenceData.ts` — **SnoMaster-specific.** Stores come from the Perigee store
  control file when loaded, else **fall back to SnoMaster's own store master** (`admin/stores.json`),
  which already keys on the Perigee visit code. The fallback's channel names are SnoMaster's, which
  may not match Perigee's — hence the warning on upload.
- `lib/callcycle/adherenceCalc.ts` — takes a local `AdherenceVisit` shape (not SnoMaster's `Visit`).

### Blob keys
`callcycle/schedule.json`, `callcycle/store-control.json`, `callcycle/team-control.json`.

### Routes
`/call-cycles` (grid + Perigee download), `/call-cycles/upload`, `/call-cycles/control-files`,
`/call-cycles/adherence`. APIs under `app/api/call-cycles/`.
⚠ The download is fetched via `authFetch`, NOT a plain `<a href>` — auth rides on the `x-user-id`
header, so a bare link 401s. `/api/call-cycles/templates` is deliberately unauthenticated (empty
scaffolding, no SnoMaster data).

### Adherence
Reuses the Perigee visit history already in SnoMaster. Expected dates are generated from cycle weeks
× days (`"Week 1&3"` + Monday → 1st & 3rd Monday of each month); the range end is capped at today.
Visit store codes are folded onto the store master's **primary** Perigee code first, so a visit logged
under an alias code still counts.

### Status
- **Build + typecheck clean.** Parser path smoke-tested end to end against a synthetic 4-week
  workbook: sheet-name email carried through, both code formats extracted, name de-duplicated,
  4 week blocks folded to `Week 1&2&3&4`, and a duplicate code across MAKRO/HIRSCH'S resolved to the
  right channel by name.
- **NOT yet run against a real SnoMaster file** — the SnoMaster-specific formats are the next job.
  Add a new parser under `lib/callcycle/parsers/` and a new `ParseMode`; do NOT bend the existing
  iRAM parsers, they are proven against iRAM's files.
- **NOT yet runtime-tested against live Blob or a real Perigee upload.**

## Outstanding To Go Live
1. Get the **SnoMaster Perigee API token** (for visits) — set in env / Perigee config page.
2. Create the **Vercel project + new Blob store** + env vars (`BLOB_READ_WRITE_TOKEN`,
   `NEXT_PUBLIC_SITE_URL`, Resend key, Perigee token). Push repo to GitHub remote.
3. Seed the super-admin (`POST /api/seed` with `snomaster-seed-2026`).
4. Build the **Hirsch's file cleaner/loader** once a sample arrives.
5. Get SnoMaster **DISPOs** (Makro) and load.
