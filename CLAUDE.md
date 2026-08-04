# SnoMaster Field Sales Portal — Current State

## ⚠ THIS PORTAL HOSTS TWO SEPARATE BUSINESSES

Read this before changing anything that touches visits, roles or Perigee.

| | **BA Measurement** | **Call Cycles** |
|---|---|---|
| People | 3rd-party brand ambassadors | SnoMaster's own internal reps |
| Department | Marketing | Sales |
| Permission prefix | `ba.*` | `cc.*` |
| Perigee token project | `ba` | `reps` |

Both sets of people live in the same Perigee account, and **their data must never
mix** — different managers, different departments, different scoring. The split
is enforced in three places:

1. **Permissions** are namespaced by project so a whole side can be switched off
   for a role in one click (`lib/roleData.ts`, sectioned catalogue).
2. **Every Perigee token carries a `project`** (`lib/perigee.ts`). Visits are
   stamped with the project of the token they arrived on and keep it forever.
3. **Readers filter by project.** `loadAllVisits('ba' | 'reps')` is the safe
   entry point; BA scoring paths call `filterVisitsByProject(..., 'ba')`.
   ⚠ A new visit reader that forgets this will silently put internal reps on the
   BA leaderboard, which is the exact failure this design exists to prevent.

Shared on purpose: the **store master** (a store is the same shop whoever visits
it) and the **Activity Log**. `system.*` permissions are portal administration.

### Permissions are REAL now (2026-08-04)
They used to be decorative — the Roles page wrote them and nothing read them.
Now: `lib/permissions.ts` `requirePermission()` guards ~90 API routes, `useAuth('perm.key')`
guards every page, and the Sidebar filters on permissions. `Role` is a plain
`string` (roles are data in `config/roles.json`), and `/api/me` re-resolves
permissions on each page load so role edits apply without re-login.
Built-in roles: `super_admin`, `md`, `admin`, `marketing`, `sales`, `client`.
`loadRoles()` migrates legacy permission keys — see `LEGACY_KEY_MAP`.

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

## SnoMaster monthly planner format (2026-08-04)

The SnoMaster reps do NOT use anything resembling the iRAM formats. Their file is a **monthly
colour-coded calendar**, one rep per file, re-sent every month:

```
 STORE CODE |    | <title>       | WEEKENDS ... <- legend block: label + FILL COLOUR
            |    |               | LEAVE / OFFICE DAY / PLANNING / VISITED / ...
            |    | SNOMASTER ... | SAT SUN MON TUE ...   <- weekday row
            |    | DATE          |  1   2   3   4  ...   <- day-of-month row
 REGION (1) |    |               |
            |  1 | Makro Carnival|         ##            <- shaded = in store on the 3rd
```

`lib/callcycle/parsers/snomasterPlanner.ts`. Anchor is a cell reading **`DATE`** followed by
1, 2, 3 — that held on all 7 real sheets even though the store-name column sits in B, C **or** D and
the header block is 7, 9 or 10 rows deep.

**Key insight:** the Nth occurrence of a weekday in a month is *always* `ceil(day / 7)`, because the
first occurrence necessarily falls on day 1-7. So "shaded Mon 3 and Mon 17" is exactly Perigee's
"Week 1&3, Monday" — no calendar maths needed beyond the division.

⚠ **Days stay attached to their own week** (`DerivedStoreCycle.perWeek`). A store is often visited on
a *different weekday each week* (one real file: Wed wk1, Thu wk2, Mon wk3, Tue wk4). Collapsing that
to "weeks 1-4 × Mon,Tue,Wed,Thu" claims 16 visits instead of 4. `cycleToEntryGroups()` emits one
schedule row per distinct day-pattern, which lands in Perigee's per-week WEEK1..WEEK6 columns.

### Why the colour key is read from the sheet, never hardcoded
Every rep's legend differs, and **the same label uses different colours in different files**
(`VISITED` is `FFFFC000`, `T5/0.000` and `FFFF99CC`). Worse, real files disagree with their own key:
- JOHN's legend says PLANNING = `T0/-0.250`; his grid uses `T0/-0.350`. Exact matching read **zero**
  visits. Hence `fillsMatch()` allows ±0.15 tint drift within the same theme.
- JOSHUA has 47 cells of `T2/-0.250` in no legend row at all.
- LISA deleted her WEEKENDS legend row but kept 860 cells of the shading.
- RUBEN-LEON's August grid has **only** weekend shading — genuinely no visits planned.

So the upload is **two-step**: `/api/call-cycles/planner/analyse` reports every colour actually used
(flagging ones absent from the legend), and the user ticks which mean "in store" before
`/api/call-cycles/planner/commit` writes anything. **A typed `1` in the cell also counts**, always,
whatever the colour — that is the format we want reps to move to, since fills do not survive
re-theming or copy-paste.

`BA IN STORE` / `AMBASSEDOR IN STORES` are explicitly excluded (Carl: different activity, never a
call cycle row).

### Fail-closed month validation
`lib/callcycle/parsers/plannerValidation.ts`. A planner states its month in three places — sheet
name, title cell, and the grid's own weekday/day-count alignment — and they disagree in real files.
LISA's is named "STORE VISITSAUGUST 2026" over a title reading "JULY 2026 STORE VISIT PLANNER". Any
disagreement **blocks the whole upload**; nothing is saved and the user fixes the file. The grid is
ground truth: only one month has both a given day-count and a given starting weekday.

### Store matching
`lib/callcycle/storeMatcher.ts`. The planners carry **no store codes** (the column exists, always
empty) and names are freehand: `Chamnerlains Riviera`, `Makro Carnivile`, `Strunenvalley`,
`CHECEKRS OUTDOOR`. Levenshtein + token overlap, returning exact/high/low/none. High confidence
needs a clear win over second place — "Makro Centurion" vs "Hirsch Centurion" score alike on the
suburb, and guessing there is the failure worth avoiding. Only exact/high auto-fill; the rest wait
for a human.

### Monthly semantics
Committing a planner **replaces** everything held for that rep. Merging would accumulate last
month's stores forever and a dropped store would never disappear.

## Store control upload is chunked, not a plain POST

`lib/callcycle/uploadStoreControl.ts`. The Perigee store export (6.5 MB) is far past the **~4.5 MB
serverless request body limit** — a platform limit, not a plan quota, so Pro does not help. The
browser parses the workbook, keeps only the columns `processStoreRows` reads, gzips, and sends it in
5000-row chunks. Chunks are staged under `callcycle/staging/store-control/<uploadId>/<n>.json` and
combined on the final chunk, so a failed upload never half-overwrites the live file.
(The iRAM build never solved this — its UI just shows "trim your file" on a 413.)

### Status
- **Build + typecheck clean.**
- **Verified against all six real planners**: 102 store cycles round-trip from the planner grid into
  the Perigee WEEK1..WEEK6 columns with zero mismatches; marked-day count equals the count implied
  by the generated rows on every file; LISA's file is correctly blocked by validation.
- The iRAM parsers were separately smoke-tested against a synthetic 4-week workbook.
- **NOT yet runtime-tested against live Blob, a real Perigee store control file, or a real Perigee
  upload.** JOSHUA's unlabelled colour and RUBEN-LEON's empty grid both need Carl to confirm intent.

## Outstanding To Go Live
1. Get the **SnoMaster Perigee API token** (for visits) — set in env / Perigee config page.
2. Create the **Vercel project + new Blob store** + env vars (`BLOB_READ_WRITE_TOKEN`,
   `NEXT_PUBLIC_SITE_URL`, Resend key, Perigee token). Push repo to GitHub remote.
3. Seed the super-admin (`POST /api/seed` with `snomaster-seed-2026`).
4. Build the **Hirsch's file cleaner/loader** once a sample arrives.
5. Get SnoMaster **DISPOs** (Makro) and load.
