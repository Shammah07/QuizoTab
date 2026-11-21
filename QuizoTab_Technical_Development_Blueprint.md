# QuizoTab Technical Development Blueprint

**Repository inspected:** `QuizoTab-main.zip` (archive revision `441c350e4acddbba796cc5bffcbd5fac688c27a6`; source files dated 2026-11-19).  
**Product:** Tanzania-focused live quizzes, tournament management, and spectator viewing.  
**Approach:** Incremental modernization; preserve the existing Next.js/React/TypeScript/Neon/Drizzle application, working quiz flows and tournament formats.  
**Status of this document:** Implementation plan and engineering reference, **not** a claim that proposed changes are already applied or tested.

## 1. Executive decision

The first release milestone is **one reliable multi-room scoring flow**:

1. An organizer creates a tournament, teams, rooms, rounds and room-specific staff assignments.
2. A judge logs in and sees *only* the room(s) and teams they are authorized to score.
3. A judge submits a score for a specific question/round; the score is saved as `pending`.
4. The designated room host sees a pending queue for their room, approves/rejects it and can request correction.
5. An approved score becomes official, updating **only the applicable room** and tournament standings.
6. Spectators can enter a public tournament code, select a room and see **only approved** records.
7. Every entry, decision and correction is attributable and preserved, including reconnects, retries, and double clicks.

**Release gate:** Do not use this in a paid/high-stakes tournament until the acceptance tests in §9 pass. No software can honestly be guaranteed to run "without any error"; the goal is to prevent, detect and recover from errors safely.

## 2. What exists today (verified in source)

- Stack: Next.js 16, React 19, TypeScript, Neon PostgreSQL (HTTP), Drizzle ORM, Tailwind CSS, Vercel target.
- `lib/db/schema.ts` has tournaments, `teams`, `tournament_judges`, `tournament_state`, `guest_codes`, quiz tables and dormant **Pesapal** payment tables.
- `lib/tournament/store.ts` persists `config`, `scores`, `pairings`, `rooms`, `judges`, `sharing` as JSON documents in `tournament_state`.
- `lib/tournament/rules.ts` has championship, quiz-night, league, knockout formats and `computeStandings`.
- `components/host/rooms-panel.tsx` assigns one `judgeId` (labelled "Host chair judge") and `panelistIds` per room. **Neither is an independent, authorized room-host role**.
- `lib/tournament/api-helpers.ts` authorizes a judge **for a tournament**, not for a specific room.
- `app/api/tournaments/[id]/judge/route.ts` accepts a judge's score **without a room ID or an identity-bound authorization check** for that room.
- `lib/tournament/store.ts::applyScoreOp()` replaces an entry with the same `(teamId, roundId)`. A simultaneous read/modify/write of the JSON `scores` document can lose updates; its comment that separate reads/writes cannot overwrite one another is **not a concurrency guarantee**.
- `app/api/host/tournaments/[id]/scores/route.ts` lets the owner approve/reject/delete scores. Approved entries are presently toggled in-place, not an immutable audit history.
- `lib/tournament/store.ts::publicView()` filters to `approved === true`, and `components/host/public-views.tsx` polls the public API at six-second intervals.
- Public URL `/host/t/[id]` and `/api/tournaments/[id]` are presently accessible by tournament UUID; guest codes exist in the store but UUID access is not a strong privacy boundary. The public API also returns room and judge metadata.
- `scripts/test-tournament.mts` uses a throwaway PGlite database and real Drizzle migrations; it is a strong starting point for regression tests.
- `lib/db/schema.ts` contains Pesapal-specific `payments` tables; **Snippe is not integrated merely because payment pages exist**.

### Keep these intact

The existing quiz creation/play modes; login/email-verification flow; existing tournament formats and round rules; existing legacy tournament scores (until migrated); components' visual styling; teams and bracket workflows; existing public standings while new room-scoring is gated.

## 3. Architecture decisions

**Source of truth:** Keep `tournament_state` JSON documents for **legacy tournament settings/pairings/rooms** initially, but introduce **normalized relational tables** for room memberships and score entries. A scoring system cannot safely rely on replacing an entire JSON array when multiple judges may save at once.

**Write path:** A new scoring service validates session identity + membership + active room + allowed team/round/question + points; inserts an event with a client-provided idempotency key. An authorized room host approves/rejects using a conditional transaction. The database is authoritative; no client-supplied `judgeName`, `approved`, `userId`, or `roomHostId` is trusted.

**Read path:** Room host reads only the authorized room's pending queue. The public endpoint reads approved records only. Existing scoring API continues for legacy tournaments until cutover; **do not calculate the same tournament from both the old JSON scores and new score entries**.

**Synchronization:** Start with 2–6 second polling, cache control `no-store`, versioned updates and a clear "last updated" indicator. Add managed real-time subscriptions later, only after database correctness and authorization tests pass. Socket delivery improves latency but is **not** the scoring source of truth.

**Sessions and permissions:** A platform-wide role `host` or `judge` is insufficient. Use tournament-scoped memberships and room-scoped assignments. A tournament owner is a super-admin for that tournament, but room hosts may only approve scores for their assigned rooms.

**Event modes:** Live quiz and physically judged tournament remain separate flows, sharing users, organizations, payment entitlement and reporting infrastructure.

## 4. Exact source files to edit for milestone 1

| Priority | Existing file | Required change | Keep |
|---|---|---|---|
| P0 | `lib/db/schema.ts` | Add `tournament_room_staff`, `tournament_score_entries`, `tournament_score_events`, indexes/check constraints. Preserve original schema. | All current tables |
| P0 | `lib/tournament/store.ts` | Add *new* atomic room-score operations or delegate to new service; avoid concurrent JSON score writes for new workflow. Preserve legacy `applyScoreOp()` temporarily. | Existing CRUD and formats |
| P0 | `lib/tournament/api-helpers.ts` | Add `requireRoomJudge()` / `requireRoomHost()` helpers using **authenticated user ID** and room assignment; fail closed. | Existing owner checks |
| P0 | `app/api/tournaments/[id]/judge/route.ts` | Route new room-score requests to authenticated service; reject room-unauthorized attempts. Restrict team registration separately. | Legacy judge GET behind feature flag |
| P0 | `app/api/host/tournaments/[id]/scores/route.ts` | Use room-scoped approval endpoint/service for new flow; never let room host approve other rooms. | Legacy owner scoring for legacy tournaments |
| P0 | `app/api/host/tournaments/[id]/route.ts` | Validate room assignments, membership, duplicates, deletion and room uniqueness server-side; don't blindly trust `normalizeRooms()` to authorize. | Existing tab/config PATCH |
| P0 | `lib/tournament/rules.ts` | Add explicit `RoomStaffRole`, `ScoreStatus`, question identifiers, snapshot rules and tests; keep existing `Score` for compatibility. | Old formats and standings |
| P0 | `components/host/rooms-panel.tsx` | Separate **Room Host** selector from **Judges**; make user assignment an explicit saved permission, not just a displayed name. | Room create/edit UI |
| P0 | `components/host/judge-dashboard.tsx` | Select/lock assigned room; show only eligible teams/rounds; include room/question/idempotency key; show pending status and actionable errors. | Existing form styling |
| P0 | `components/host/scores-panel.tsx` | Room-filtered approval queue with approve/reject/correction, actor/timestamp and double-click disable. | Existing overview for legacy scores |
| P0 | `components/host/dashboard.tsx` | Separate tournament overview from room-host score queue; fetch new room-score endpoints; refresh on mutation success. | Existing tabs |
| P0 | `lib/tournament/store.ts::publicView()` | For new tournaments read **only approved** normalized entries; project room scoreboard and overall standings; never expose draft entries. | Existing public contract where possible |
| P0 | `app/api/tournaments/[id]/route.ts` | Enforce public sharing visibility, server-side field allowlist and approved-only read; `Cache-Control: no-store`. | Existing public endpoint |
| P0 | `components/host/public-views.tsx` | Room selector, timestamp, pending-safe board, empty/unavailable states. | Existing standings design |
| P0 | `scripts/test-tournament.mts` | Add concurrent writes, double submissions, wrong-room judges, host approvals, score privacy, room filtering tests. | Existing regression tests |

### New files to add (do not replace old screens wholesale)

- `lib/tournament/room-scoring.ts`: transaction-safe score submission and decisions.
- `lib/tournament/room-access.ts`: authorization and assignment lookups.
- `lib/tournament/room-standings.ts`: pure deterministic calculation from approved records.
- `app/api/tournaments/[id]/rooms/[roomId]/scores/route.ts`: judge score submissions and authorized room reads.
- `app/api/tournaments/[id]/rooms/[roomId]/decisions/route.ts`: room-host approvals/rejections.
- `app/api/tournaments/[id]/rooms/[roomId]/public/route.ts`: approved-only room spectator view.
- `components/host/room-host-dashboard.tsx`: room-host review UI.
- `app/host/[id]/rooms/[roomId]/page.tsx`: authenticated room-host page.
- `scripts/test-room-scoring.mts`: repeatable milestone integration tests.
- New Drizzle migration generated using `npm run db:generate`, reviewed before application.

## 5. Data model (recommended)

### `tournament_room_staff`

Columns: `id uuid PK`, `tournament_id uuid FK`, `room_id text NOT NULL`, `user_id integer FK`, `role text CHECK ('room_host','judge')`, `created_at timestamptz`. Unique membership `(tournament_id,room_id,user_id,role)`. Add uniqueness enforcing **one active room host per room** if your competition rule requires one. For this first release, assign one role per user per tournament/room, and disallow conflicting assignments in the service. Validate room ID against the existing `rooms` document until rooms become a normalized table. Treat `rooms-panel` IDs as opaque strings (currently created with `uid()`, not UUIDs).

### `tournament_score_entries`

Columns: `id uuid PK`, `tournament_id uuid FK`, `room_id text`, `round_id text`, `question_key text`, `team_id uuid FK`, `points integer`, `status ('pending'|'approved'|'rejected'|'superseded')`, `judge_user_id integer FK`, `reviewer_user_id integer NULL FK`, `reviewed_at timestamptz NULL`, `created_at timestamptz`, `client_request_id uuid UNIQUE`, `revision integer`, `correction_of uuid NULL FK`, `reason text NULL`. Enforce `points` as an integer for v1. Decimal scoring is a future schema/requirements decision, not an accidental float behavior.

**Scoring semantics:** one accepted score for a team's question attempt, with explicit question ID; a correction is a *new* entry referring to the old one. Do not replace or delete the historical entry. If two judges must separately mark a question, add a consensus/decision policy; for milestone 1 nominate one recording judge per attempt or explicitly define review precedence.

### `tournament_score_events`

Columns: `id uuid PK`, `score_entry_id uuid FK`, `actor_user_id integer FK`, `event_type ('submitted','approved','rejected','superseded')`, `details jsonb`, `created_at timestamptz`. Append-only for audit. An approval and audit event must commit together.

### Foreign-key and logical integrity

The `teams` table already has `tournament_id`; verify at write time that the scored team belongs to the same tournament. Validate that `room_id` exists and the team is *currently assigned to that room through a released pairing/fixture*. Do not let a judge score arbitrary tournament teams. Validate that the round belongs to the tournament config and that `question_key` belongs to an authorized round/question or an explicitly configured manual question slot. Any match qualification logic should use its specific match/room, not combine unrelated rooms' raw points.

### Safe migration rule

**Additive migration only.** Do not drop, rename, or overwrite the legacy `tournament_state.scores` JSON. Introduce `scoring_engine_version` per tournament (e.g. `legacy` vs `room_v1`); the reader and writer must agree on the version. Enable `room_v1` only for **new test tournaments** first. Historical tournaments retain `legacy` unless a separately tested backfill is run. Take a Neon backup/restore point before applying migrations to production.

## 6. Required API contracts

### Judge submits a score

`POST /api/tournaments/:id/rooms/:roomId/scores`

```json
{
  "roundId": "existing-config-round-id",
  "questionKey": "q-0007",
  "teamId": "existing-team-uuid",
  "points": 10,
  "clientRequestId": "new-uuid-generated-once-per-button-action"
}
```

Server derives judge ID from session, validates staff assignment, team/fixture, round/question, score range and tournament state. One database transaction inserts the `pending` score and `submitted` event. A retry with the same `clientRequestId` returns the original result rather than creating a second score. Respond `201` for a new entry and `200` for a recognized duplicate. A conflicting retry payload should return `409`.

### Room host approves or rejects

`POST /api/tournaments/:id/rooms/:roomId/decisions`

```json
{ "scoreId": "pending-score-uuid", "decision": "approve", "reason": "" }
```

Server derives approver ID from session, validates `room_host` assignment or tournament owner, then runs a conditional status transition from `pending` to `approved` or `rejected`, writes the audit event in the same transaction, and returns the updated room board version. Duplicate approvals must not silently create another event or award points twice. Do not let an approval use arbitrary user-supplied room or reviewer fields.

### Spectator reads a room

`GET /api/tournaments/:id/rooms/:roomId/public`

Response should contain `{tournament, room, teams, currentRound, approvedScores, standings, updatedAt}`. It must **not** contain pending entries, judge email addresses, authentication data, unreleased questions, private presentation URLs or guest secrets. Check tournament sharing settings and exposure policy; choose whether an opaque tournament UUID alone suffices or spectator access must include a guest code/session.

### Error codes

`400` invalid data, `401` unauthenticated, `403` authenticated but wrong role/room, `404` unknown resource or intentionally concealed tournament, `409` duplicate/conflicting attempt or already-decided score, `422` incompatible round/fixture, `503` unavailable database. Do not return raw SQL errors to users.

## 7. Implementation sequence, minimizing breakage

### PR 0 — Establish a clean baseline

1. Create a Git branch and a Neon development database branch. Never use production first.
2. Install dependencies and execute the **existing** checks (§8).
3. Record existing errors before editing. Preserve passing test output and screenshots of the host/judge/public flows.
4. Confirm `DATABASE_URL` points to **development** before running migration commands.

### PR 1 — Additive database schema and permission primitives

1. Add three new tables to `lib/db/schema.ts` and generate a Drizzle migration.
2. Add `room-access.ts` that checks the logged-in numeric `userId` against staff assignments; also confirms room belongs to tournament.
3. Modify the room-management PATCH and UI to save explicit room-host/judge assignments server-side; forbid assigning `name-only` judges as authenticated staff. Keep the old room JSON as the layout source until normalized `rooms` exists.
4. Create tests: owner, correct-room judge, wrong-room judge, unassigned user, correct-room host, wrong-room host.

**Exit check:** Unauthorized user cannot submit or approve, even if they handcraft a POST request.

### PR 2 — Transactional score writes and reviews

1. Write `room-scoring.ts` backed by relational rows and a transactional Postgres connection when necessary (the existing `lib/db/index.ts` uses Neon HTTP, and current `Db` typing alone does not promise interactive transactions).
2. Validate IDs, ranges, pairing/team assignment, question key and lifecycle state before insert.
3. Apply idempotency; use conditional `UPDATE ... WHERE status='pending' RETURNING ...` for decisions.
4. Insert immutable audit events in the same transaction as the change. Protect concurrent attempts to approve the same score.
5. New room API routes call the service; leave legacy endpoints for legacy tournaments. **Do not route new scores through legacy `applyScoreOp()`**.

**Exit check:** Simultaneous submissions are preserved and a repeated approval never awards twice.

### PR 3 — Hook up existing screens

1. Enhance `rooms-panel.tsx` to assign staff, release a fixture, and show its current room host.
2. Adjust `judge-dashboard.tsx` to display current assigned room, eligible teams, question slot, pending submissions and errors; prevent duplicate button submits.
3. Add `room-host-dashboard.tsx` as a focused pending-review screen. Link to it from `dashboard.tsx`; don't give a room host tournament-wide admin controls.
4. Extend `scores-panel.tsx` for official room-scoped history and pending totals.

**Exit check:** Judge submits → host approves on another browser → official status displays correctly.

### PR 4 — Spectator + official standings

1. Use a pure `room-standings.ts` function over **approved new-mode records** only.
2. Extend public views with room selector and score freshness; add guest-code handling on the public entry route.
3. Keep tournament-wide rankings separate from room match totals; apply configured qualification/tie-break policies.
4. Test private/pending records never leak in public payloads.

**Exit check:** Before approval, public score does not change. After approval, room and overall **eligible** standings update within the agreed polling window.

### PR 5 — Production readiness

1. Test with 2 rooms, 4 teams each, two judges and one room host per room, on separate devices.
2. Test airplane-mode interruptions, repeated requests, two simultaneous judge submissions, two simultaneous host clicks, rejected/edited scoring, wrong-room requests.
3. Review accessibility and device widths, monitor logs/errors and database query volume.
4. Deploy development → Vercel preview → closed pilot → production behind a feature flag.

## 8. Commands to run locally

These use scripts present in `package.json`. Commands are for a Mac/Linux terminal (PowerShell commands may need adjustment).

```bash
# From the extracted QuizoTab-main project folder:
node --version
npm --version
npm ci

# Baseline checks BEFORE modifying code:
npm run typecheck
npm run lint
npm test
npm run build

# Start development server:
cp .env.example .env.local   # edit locally, NEVER commit credentials
npm run dev
```

**Notes:** `npm test` uses PGlite, so it is meant to run without live Neon access; account/email tests may still need their test-defined environment. `npm run build` may fail if required environment variables are missing; record exact output, don't invent placeholders for production secrets. Check `README.md`/`.env.example` for actual names.

**Before ANY database migration**:

```bash
# Work only on a Neon DEVELOPMENT branch with a verified DATABASE_URL_UNPOOLED
npm run db:generate
# REVIEW the newly generated SQL, including constraints and any DROP statements
npm run db:migrate

# Rerun all checks and start the UI:
npm run typecheck
npm run lint
npm test
npm run build
npm run dev
```

Avoid `drizzle-kit push` or destructive schema resets against production. Never put `DATABASE_URL`, Snippe secrets, HMAC secrets or session keys into chat, GitHub, screenshots or test fixtures. `git status` should show `.env.local` untracked/ignored.

**Useful safe Git sequence:**

```bash
git checkout -b feature/room-score-approval
# edit + check files
git diff --check
git status
git add lib app components scripts drizzle
# Review staged files for accidental .env or secret additions
git diff --cached --stat
git commit -m "Add room-scoped score approval workflow"
git push -u origin feature/room-score-approval
```

Create a pull request and deploy to Vercel **Preview** before merging. Ensure Vercel preview uses development/test Neon credentials and not the production database.

## 9. Acceptance tests (must pass)

1. **Room isolation:** Judge A assigned to Room A posts Room B score → `403`, no DB change.
2. **Authentication:** Logged-out submission → `401`, no DB change.
3. **Team isolation:** Room A judge submits for a team in Room B → reject.
4. **Scoring limits:** Negative/oversized/out-of-range/noninteger/NaN points → reject.
5. **Pending privacy:** Judge submits +10 → saved pending; public Room A score remains unchanged.
6. **Approval:** Correct Room A host approves → one official +10; audit event stores identity and time.
7. **Wrong approver:** Room B host approves Room A score → `403`.
8. **Double click:** Same idempotency key sent twice → one score record, one submitted event.
9. **Concurrent submissions:** Two different judges submit independent valid attempts together → both survive.
10. **Double approval:** Two host requests compete → one transition, one approved event, no duplicate points.
11. **Correction:** Approved score corrected → old event retained; revised score uses explicit supersession/review.
12. **Rejection:** Rejected score excluded from public standings; reason retained.
13. **Cross-room totals:** Match scores don't leak into another room's table; qualification aggregates correctly.
14. **Connectivity:** Disconnect after send, retry same request ID → no duplicate.
15. **Old tournaments:** Existing `legacy` scores still render and do not acquire new-mode duplicates.
16. **Public information:** No pending points, staff emails, confidential question sets or private files in public response.
17. **One-room pilot:** Judge → room host → spectator updates successfully on different devices.
18. **Multi-room pilot:** Room A and B operate concurrently, including simultaneous approvals.

## 10. Later roadmap (after milestone 1)

| Order | Product increment | Files/areas to extend |
|---|---|---|
| 2 | Round/question master data, category rules and match clock | `lib/tournament/rules.ts`, new question tables, judge form, presentation flow |
| 3 | PowerPoint upload, preview, browser display and slide/round sync | New `lib/presentations/*`, storage helper, new presentation API/UI, object storage (not Neon blobs) |
| 4 | Reliable spectator tournament codes, room selection, public directory and results | `guest_codes`, `publicView`, `components/host/public-views.tsx`, new viewer routes |
| 5 | Real-time delivery with reconciliation | `lib/realtime.ts`, dashboard subscription hooks; DB remains source of truth |
| 6 | Snippe verified checkout, orders, webhooks, idempotent entitlements | `lib/db/schema.ts` payment models, `lib/pricing.ts`, new `lib/payments/sni...`, checkout/callback routes; remove Pesapal assumptions only after migration |
| 7 | Institutional profiles, team member identity, registration approvals | new organizations/schools/persons tables, registration screens |
| 8 | Self-practice, educator analytics and reviewed question library | `lib/quiz/*`, quiz components, educational moderation |
| 9 | Bilingual English/Kiswahili UI and lightweight Android performance | `lib/i18n/*`, UI components, slow-network testing |
| 10 | Branded reports, certificates and event exports | new reporting service and templates |

**For payments:** Do not connect an unverified return URL directly to event creation. Verify provider server-side events/signatures and amounts, then grant the paid feature idempotently. Confirm the actual Snippe integration model before changing currently Pesapal-oriented tables.

## 11. Major hidden failure modes to fix before launch

- **Race condition:** `readState()` → calculate next score array → `writeState()` can overwrite concurrent changes.
- **Authorization:** tournament-level judge permission currently grants a broader scope than intended.
- **Missing room host role:** UI currently calls a `judgeId` a “host chair judge,” not independent host permission.
- **Round-level data:** old `Score` has no `roomId`, `questionKey`, numeric actor ID or audit revision.
- **In-place edits:** existing score update deletes evidence of prior values; explicit deletion also discards history.
- **Potential public overexposure:** public UUID routes are accessible without confirming sharing visibility; decide your public/privacy contract.
- **Legacy/modern dual counting:** a partial migration can double award points unless read paths are version-gated.
- **Untrusted client room/team associations:** route must derive permissions from authenticated user and server-side fixtures.
- **Synchronous migration risk:** schema/migrations should be verified on a Neon branch, backed up, and staged before production.
- **Payment confusion:** DB contains Pesapal-oriented legacy payment metadata whereas intended future provider is Snippe.

## 12. Product vision and guardrails

QuizoTab Live offers creator-led and self-paced knowledge games; QuizoTab Tournaments is the professional, physical or hybrid multi-room control system; QuizoTab Spectate is an approved-score viewing experience. Keep joining/spectating free and evaluate pricing by event scale. Focus first on schools/universities, with corporate and community formats supported by configurable rules. Prioritize English/Kiswahili usability, affordable mobile devices, low-bandwidth operation, and predictable recovery from interrupted connectivity. Add question libraries and AI assistance only after editorial accuracy and event reliability are established.

**Definition of done for milestone 1:** An organizer can create a two-room tournament; assign actual accounts as judges and room hosts; judges record authorized question-level scores; hosts approve only their room; spectators see official room scores and correct tournament results; all actions are durable, idempotent, permission-checked, auditable and covered by reproducible tests.

---

## 13. Immediate next action (practical)

**Do not paste untested SQL into production.** First run baseline checks on a development branch. Then implement PR 1 (schema + authorization) and write its tests; only after those tests pass proceed to score writes. When something fails, capture the full terminal error and the filename/line number, without credentials. This lets the next fix address a reproducible defect rather than guessing.
