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

## Later roadmap (not now)
PPTX upload/rendering, sync to question IDs, more advanced spectator experience, realtime service, verified Snippe payment entitlements, institution profiles, question library/practice analytics, optional buzzer. Ensure current milestone is stable first.

## First message to Codex
"Read `QUIZOTAB_CODEX_HANDOFF.md` and `QuizoTab_Technical_Development_Blueprint.md` in full. Inspect the existing QuizoTab repo. Before editing, explain which milestone-1 functionality already exists, missing parts, exact files to change, security/concurrency risks, and an incremental implementation plan. Do not remove or replace working functionality. Run baseline checks first and report actual outcomes. Then implement milestone 1 in small testable steps. Do not use or alter the production Neon database."
