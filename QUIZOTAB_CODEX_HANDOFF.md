# QuizoTab — Codex continuation handoff

## Purpose
This file transfers the decisions and next actions from a ChatGPT product-planning and code-audit conversation into the local QuizoTab codebase. Read this file **and** `QuizoTab_Technical_Development_Blueprint.md`, then inspect actual source files before changing anything. This is context, not proof that proposed features have been implemented.

## Product vision
QuizoTab is a Tanzania-focused platform for (1) Kahoot/Wayground-inspired live quizzes with codes, interactive answers, practice and leaderboards; and (2) physical quiz tournaments for schools, universities, companies and community groups, with teams assigned to rooms, judges manually recording question-level scores, independent room hosts approving entries, and spectators viewing approved live standings using a public tournament code. Contestants in physical tournaments use a physical buzzer; an optional digital buzzer may be added later. Tournament organizers should be able to upload PPTX slides for projected questions. Support Kiswahili/English, mobile-first interfaces, unreliable connectivity, and local needs. Paid event hosting will eventually use Snippe, while joining and spectating should remain free where appropriate.

## Current technology and deployment
Next.js 16, React 19, TypeScript, Tailwind CSS 4, Drizzle ORM, Neon PostgreSQL, Vercel. Live site: https://quizo-tab2.vercel.app/ . Prior review was based on an uploaded source archive `QuizoTab-main.zip` dated around 2026-11-19; local working tree may have changed. Do not assume every feature mentioned here works without verifying.

## Existing components and modules to preserve/improve
- `lib/db/schema.ts`: existing database entities; add normalized tables; no destructive changes.
- `lib/tournament/store.ts`: existing JSON-backed state and `applyScoreOp` legacy scoring; preserve legacy flows during staged migration.
- `lib/tournament/rules.ts`: existing championship, quiz-night, league and knockout rule logic.
- `lib/tournament/api-helpers.ts`: current tournament-level authorization; add room-scoped checks.
- `app/api/tournaments/[id]/judge/route.ts`: current judge API; verify authorization before migrating new score writes.
- `app/api/host/tournaments/[id]/scores/route.ts`: legacy score approvals; introduce room-scoped service/endpoint.
- `app/api/host/tournaments/[id]/route.ts`: room configuration update validation.
- `app/api/tournaments/[id]/route.ts`: public tournament response; only show approved data and enforce visibility.
- `components/host/rooms-panel.tsx`: distinguish room host from judge and save authoritative assignments.
- `components/host/judge-dashboard.tsx`: room-scoped judging and pending confirmation.
- `components/host/scores-panel.tsx`: pending approvals/rejections and audit details.
- `components/host/dashboard.tsx`: tournament admin vs room host experience.
- `components/host/public-views.tsx`: public room choice, approved-only scoreboard.
- `scripts/test-tournament.mts`: existing regression suite and PGlite test environment.

## Critical current risks observed in prior source review
1. Tournament scoring writes JSON state using read-modify-write, risking lost updates under concurrent requests.
2. Judge authorization is tournament-wide, not tied to room assignment.
3. Existing score can be replaced rather than retaining question-level history and correction trail.
4. Rooms currently use `judgeId` / `panelistIds`; room-host role must be introduced without breaking prior records.
5. Public views use polling; retain initially, then optimize after correctness.
6. Snippe is not integrated and existing payment schema includes Pesapal references; do not confuse them.

## Priority milestone: reliable room-scoring workflow
The first deliverable is an end-to-end functional flow:
1. Organizer registers teams, rooms and assigns room hosts/judges.
2. Authenticated judge sees only assigned rooms and eligible teams, enters an individual question score.
3. Server validates room assignment, team, round, points and a persistent `clientRequestId`; inserts a pending record atomically.
4. Authenticated room host reviews pending scores from their room, approves/rejects, with an audit event.
5. Approved records update official room/tournament standings; pending/rejected records must never leak into public standings.
6. Public users enter a tournament code, choose a room, and see approved-only standings.
7. Reconnects, retries, double-clicks, concurrent judges and cross-room access remain safe.

## Engineering approach
- Keep current live-quiz, auth, scoring and tournament functionality working throughout upgrades.
- Build relational `tournament_room_staff`, `tournament_score_entries`, `tournament_score_events` using Drizzle; carefully inspect schema and migration scripts first.
- Add separate `lib/tournament/room-access.ts`, `room-scoring.ts`, `room-standings.ts` as appropriate. Use Neon-backed transactional or atomic operations; test concurrency.
- Add APIs under `app/api/tournaments/[id]/rooms/[roomId]/` for scores, decisions and approved public results; use session-bound identity and backend authorization.
- Do not double-count legacy JSON scores and new normalized scores; gate migration by event/feature version.
- Prefer polling initially (2–6 seconds) with `no-store` and visible last-updated state; realtime service is later.
- Use an isolated Neon development branch and reviewed migrations before production.
- Guard against unauthorized scoring, duplicate requests, overwrites, accidental data disclosure and partial failures.

## Acceptance tests
Judge assigned Room A can submit Room A score but not Room B. Room B host cannot approve Room A. A score is pending and invisible publicly until authorized approval. Approved scores appear in the correct room, not other rooms. Two parallel judge submissions both persist. Retrying the same client request cannot duplicate score. Corrections preserve original entries and approver/judge audit history. Offline/retry behavior is explicit. Existing quiz functionality and tournament modes continue passing regressions.

## Work instructions for Codex
1. **Start by inspecting the actual repository and reading the full blueprint; do not immediately edit code.** Confirm paths, existing behavior, package scripts, schema, auth, and migration setup, and report differences from this handoff.
2. Create a Git feature branch/checkpoint; avoid overwriting user work.
3. Run available baseline scripts (`npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`) after confirming `package.json` scripts. Record any pre-existing failures.
4. Implement **only milestone 1** in small reviewable changes, database-first, then service/API, UI, and tests. Don't rewrite functioning modules.
5. Write integration/authorization/concurrency tests. Explain and verify each migration before applying it; never run production migrations or expose `.env` secrets without approval.
6. For each change: list files changed, tests actually run with results, residual risks, manual verification steps, and rollback steps. Never claim “zero errors” or tested behavior without evidence.

## Implemented room assignment contract (Unit 2)

Owners can prepare account-bound room assignments on the Rooms tab while the database gate keeps scoring on `legacy`. JSON rooms own their stable IDs and display labels. Active relational assignments own permissions. An owner assigns a verified account by exact email. Removing a legacy judge label leaves its separately managed room role intact.

Owner room commands carry the revision returned by `GET /api/host/tournaments/[id]/rooms`. Their transaction locks the tournament row before validating the revision, JSON room IDs, and current assignments. Draw changes that reference rooms use the same lock and compare the expected draw. Future score writes must take a compatible tournament lock before checking room access and recording an entry. A released pairing or any score entry blocks permanent room deletion. Allowed deletion clears draft references and timestamps active assignments as revoked.

The staff assignment endpoint returns only the signed-in account's requested room and role. Scoring callers must use the engine-gated judge/host helpers inside their write transaction. The existing Neon HTTP client serves unrelated operations. Interactive room mutations use the Neon pooled adapter. Rehearse independent-connection locking on a separately approved development database before opening pilot scoring.

## Unit 3 submission contract (dormant)

`POST /api/tournaments/[id]/rooms/[roomId]/scores` accepts exactly
`{contextId, teamId, roundId, questionKey, points, clientRequestId}`.
Keep the UUID request ID across retries. An insert returns 201 and an exact
retry returns 200 with the same `{scoreId, status: "pending"}` receipt.
Authorization and the engine gate are checked on every request, including retries.
The service locks the tournament before checking the assignment, current release,
team membership, question limits and available round points. The score and its
submitted event commit together. The legacy-only database constraint keeps the
route dormant.

The existing owner tournament PATCH accepts an optional `scoringPlan` document:

```json
{
  "rounds": [
    {"id": "existing-round-id", "questions": [{"id": "q-a", "minPoints": 0, "maxPoints": 3}]}
  ],
  "rosters": []
}
```

Question IDs are stable within the round and independent of display order.
Set the combined question minima and maxima within the configured round range.
For draws, the context ID is the existing released pairing ID. For quiz night
and league, each roster supplies its own stable `id`, `roomId`, `roundId`,
`teamIds` and explicit boolean `released`. One team can join one released
roster per round. The document is stored under a separate tournament-state key.
The public and legacy state readers do not include it.

The regular test suite exercises the API and concurrent requests in PGlite.
For the opt-in Neon test, run `npm run db:verify:dev` followed by
`npm run test:score-submissions:dev`. It verifies both live connections,
journal hashes and the enforced gate before opening rollback-only fixtures.
Only the test adapter substitutes the engine read for a synthetic tournament
to exercise the post-gate path. Application code has no activation override.

## Unit 4 room-host review (dormant)

Under `/api/tournaments/[id]/rooms/[roomId]`, the assigned host can GET
`scores/pending` and POST `decisions` with `{scoreId, decision: "approve"}`
or `{scoreId, decision: "reject", reason}`. A decided entry returns 409 on
another decision. The server rechecks the release, room assignment, attempt
eligibility and point limits under the tournament lock. A former judge who
becomes a host cannot review their own submission.

An assigned judge can POST `corrections` with `{scoreId, points, reason,
clientRequestId}`, where scoreId identifies the current approved revision.
The prior award stays effective until a host approves its pending replacement.
Approval preserves the prior award's original reviewer, review time and points,
marks it superseded, and records the superseding actor in its audit event.
Rejection leaves the prior award effective. The submitted event and correction
entry retain the proposal reason; the rejected event retains the rejection reason.
Round capacity reserves the larger pending/approved value per attempt. None
of these operations writes to the legacy scores document or spectator response.

## Milestone 1 Unit 5 — official standings and spectator access

The audience directory and guest-code entry are at `/host/t`. Existing UUID links remain bearer links. Code-based pages keep the code in subsequent requests so rotation revokes that access. Disable both sections on an unlisted tournament to revoke all spectator access. Paired room standings require draw sharing because the room roster reveals opponents.

The SSR pages and six-second refresh use the same read-only repeatable-read projection. Legacy tournaments use approved JSON scores. Room scoring uses only the effective approved revision per attempt. A released fixture needs an owner-set `completedContexts` marker in the scoring plan and approved coverage for every planned question and participant. A released bye can be explicitly closed. The server checks prerequisite stages and eligible entrants before saving a subsequent draw. The existing database constraint still permits only legacy tournaments. Older legacy approvals have no reliable approval timestamp.

## Unit 6A — controlled closure and rejected-score replacement

Under `/api/tournaments/[id]/rooms/[roomId]`, the existing corrections POST accepts a reasoned replacement against the latest rejected revision when the attempt has no effective award. Approval preserves its rejected predecessor. Ordinary corrections still target the effective approved award.

GET `completion?contextId=...` as the assigned host (or GET `reopen?contextId=...` as the owner) for the configuration digest, tournament-wide lifecycle revision and completion status. POST the context ID and both revisions to the corresponding endpoint. Reopen additionally requires a reason. Refresh on a revision conflict. An immediate exact close retry returns the recorded state. New scoring requires an open context; existing submission receipts can still be retried.

The tournament lock serializes lifecycle, assignment and scoring commands. Closure checks release, participant and question coverage, pending reviews and outcome. Knockout ties require the recorded tiebreak; preliminary draws and points rosters do not need a winner. Generic plan edits retain completion markers. Each successful transition inserts a separate tournament-state row under the fixtureEvent prefix; existing events are never updated by the application. These lifecycle records have application-level protection. The database trigger continues to protect score events. A later draft or released draw blocks reopening; downstream adjudication is deferred to Unit 6B. The legacy-only database constraint stays in place.

## Unit 6B — Post-advancement corrections

The owner overview and owner-only adjudication API expose pending competitive conflicts. Under the tournament lock, the room-host decision service compares effective awards, tiebreaks, qualification, seeding and dependent fixtures. An owner may hold proceedings, lift a hold, withdraw unplayed dependent drafts, or uphold an existing released or scored bracket with a reason. The assigned room host retains responsibility for the actual score decision. Consequential changes to a finalized result require reopening and subsequent completion. Rulings are versioned tournament state records written in the same transaction as the action.

The default Neon regression uses rollback fixtures. The focused `npm run test:score-submissions:dev -- --adjudication-only` run also exercises independent commits and archives its unlisted synthetic tournament to retain audit history. The database activation constraint remains in force.

## Unit 6C — Signed-in room staff

The staff directory at `/staff` lists active room assignments independently of legacy judge access. Each workspace reloads released fixtures or rosters, question limits and room history from an authenticated, engine-gated read endpoint. Other judges’ private pending points and reasons are withheld. Judges use the existing score and correction endpoints. Room hosts use the existing queue, decision and completion endpoints. Completion previews execute the same validations up to the first write. Adjudication flags on queue items use the same restrictions as the decision service.

Only opaque retry IDs and payload digests persist in tab storage. After a lost response, refresh the room and, if the attempt is still absent, re-enter identical details in the same tab. A changed payload receives a separate ID.

## Unit 6D — Administrator configuration and monitoring

Room operations in the existing owner dashboard reads one repeatable-read snapshot for all rooms. It shows relational active staff assignments, draft and released contexts, effective approved question coverage, pending reviews, closure markers and adjudication blockers. The Unit 6B adjudication panel owns ruling actions. Legacy scoring stays available through the original screens.

The plan editor submits its original revision. The owner transaction locks the tournament, reloads dependencies, checks the revision and validates the plan. Question IDs are stored per round. A team can occupy one room roster per round. Drafts can be prepared while room scoring is disabled. Explicit roster release checks the active tournament, registered members, assigned staff, and scoring limits. Withdrawal is limited to open rosters without any scoring history. Planning and release do not activate the scoring engine.

Run the focused owner UI test with `node --import tsx scripts/test-staff-browser.mts --operations`. It uses an isolated browser profile and synthetic localhost responses. The service and route regressions are included in `npm test`.

## Unit 6E-A pilot startup and browser readiness

Stage 6E-C1A targets the separate testing project `QuizoTab-Pilot`, whose default branch is named `production`. Use the authenticated Neon Console or control plane to independently record the project ID, the actual branch ID and its read-write endpoint ID and full direct hostname. Protect this operator-controlled JSON manifest against modification by the application account. It requires exactly `projectId`, `branchId`, `endpointId`, `directHost`, `database` (exactly `quizotab_pilot`), `runtimeRole`, and `setupRole`. The endpoint ID must match the direct hostname's first label. Pin distinct authorized roles for runtime and setup. Reserve `quizotab_pilot_owner` for administration. Obtain the pins independently of the credential files. The previous child-branch manifest is rejected.

Use a dedicated local worktree with a trusted production build and no Next production dotenv files, including `.env.local`. Store both inputs outside Git with restricted OS permissions.

- `npm run start:pilot -- <absolute-pins-file> <absolute-runtime-env-file>` accepts the pooled `DATABASE_URL` and fresh pilot `SESSION_SECRET` and `HMAC_SECRET`. The launcher rejects inherited database and TLS settings. Before starting Next on loopback, it checks the project, branch, endpoint, database, login role and effective role over Neon HTTP and inside a pooled transaction. Missing identity information or any mismatch refuses startup. The Next startup hook repeats the checks on its own runtime clients.
- `npm run pilot:verify:setup -- <absolute-pins-file> <absolute-setup-env-file>` accepts only the same pooled runtime URL and the direct setup-role `DATABASE_URL_UNPOOLED`. The direct connection must pass the same identity checks for the setup role. This command requires separate live verification authorization.
- Legacy score mutations and live quiz imports acquire the tournament lock and verify its engine. Creation requires a persisted host account and explicitly creates legacy tournaments. In Room operations, the owner can review a completed fixture or roster, inspect the lifecycle service's dependency checks, and supply a reason to reopen against the displayed revisions. Room-host score decisions retain their separate assignment requirement.
- `npm test` exercises refusal paths locally and uses PGlite for scoring and lifecycle integration. `node --import tsx scripts/test-staff-browser.mts --operations` exercises the actual administrator components in Chromium using synthetic HTTP responses. Successful startup on a real pilot branch requires separately authorized verification.

## Stage 6E-C2 pilot schema installation

The two pilot commands accept the same absolute pins and setup credential paths as the setup verifier. The command pins a digest of the seven independently verified manifest fields. A change of project, endpoint or role requires a reviewed pin update. Keep the files under operator control outside the worktree. Use the isolated checkout with a clean shell and the setup file containing exactly one assignment per URL.

1. Review the approved SQL, ordered Drizzle journal and SHA-256 constants in `scripts/pilot-migration.ts`. Confirm the pilot project, branch and endpoint in the Neon Console and reserve the target for this installation. Other DDL clients must stay disconnected during installation.
2. With separate permission for live read-only checks, run `npm run pilot:migrate:preflight -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\setup.env"`. This verifies both runtime adapters and the direct setup session, requires an empty application schema and absent Drizzle history, and reports missing effective privileges by name. Treat any existing user schema, extension objects in public or event trigger as a stop for operator review. Provisioning default ACLs are allowed.
3. The setup login needs CONNECT and CREATE on the pilot database, USAGE and CREATE on public, and USAGE on plpgsql. Database CREATE lets Drizzle create its journal schema. The same role owns all objects it creates, including the journal, tables and trigger function. Normal PostgreSQL built-in type and function privileges are assumed. Only independently confirmed missing privileges need separate authorization. Re-run preflight after any approved grant.
4. After successful preflight and explicit live installation approval, the installation command is `npm run pilot:migrate -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\setup.env"`. It repeats the checks, takes a transaction advisory lock, and applies the verified in-memory batch through Drizzle. Both journal rows and schema protections are verified before commit.
5. A pre-commit failure rolls back the installation. A lost commit acknowledgement leaves the outcome uncertain. Inspect the pilot journal and schema read-only before considering a retry. A repeat invocation refuses existing history. Keep any recovery, grants, seeding, engine activation and application startup under separate authorization.

## Later roadmap (not now)
PPTX upload/rendering, sync to question IDs, more advanced spectator experience, realtime service, verified Snippe payment entitlements, institution profiles, question library/practice analytics, optional buzzer. Ensure current milestone is stable first.

## First message to Codex
"Read `QUIZOTAB_CODEX_HANDOFF.md` and `QuizoTab_Technical_Development_Blueprint.md` in full. Inspect the existing QuizoTab repo. Before editing, explain which milestone-1 functionality already exists, missing parts, exact files to change, security/concurrency risks, and an incremental implementation plan. Do not remove or replace working functionality. Run baseline checks first and report actual outcomes. Then implement milestone 1 in small testable steps. Do not use or alter the production Neon database."
