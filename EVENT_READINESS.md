# Integrated event readiness assessment

**24 November 2026 · NO-GO for a real multi-room event.** The evidence supports a supervised rehearsal on a separately authorized staging deployment. The remaining decision turns on independent database concurrency, ingress and account controls, venue connectivity, and recovery under event-sized load.

## Verified live baseline

The pinned HTTP runtime, pooled runtime and direct setup checks identified project `noisy-violet-99522280`, branch `br-restless-king-bdli89ow`, endpoint `ep-long-fog-bdc5rxjn`, database `quizotab_pilot`, runtime `quizotab_pilot_app` and setup `quizotab_pilot_setup`. The closed-state verifier and a separate read-only scoring snapshot passed. Admission was closed, with zero hosts. The installed admission upgrade, schema fingerprint, canonical migration journal, enabled admission and append-only triggers, ownership and full runtime profile passed verification, with zero missing and excess privileges. Runtime was excluded from admission administration and the migration journal.

The pilot championship tournament was active, owned by account 8 and using `room_v1`. The draw contained exactly two released, completed Match 1 fixtures, East and West. Match 2 had **zero drafts and zero releases**. Lifecycle revision 4 comprised East close, West close, East reopen and East reclose. There were zero outstanding adjudication cases or ruling records. The retained entries, score events, staff, pairings and lifecycle records matched the prior snapshot.

| Effective standings | Amber | Cobalt | Jade | Ochre |
|---|---:|---:|---:|---:|
| Official points | 3 | 8 | 4 | 6 |

Of 10 score entries, eight were approved, one superseded and one rejected. There were zero pending scores and 21 scoring events. Historical pilot rehearsals exercised identical requests, conflicting request IDs and independent cross-room submissions. This milestone's live evidence is read-only.

## Architecture and local changes

Next.js pages, server actions and JSON handlers call the existing TypeScript services. Drizzle uses Neon HTTP for individual queries and a pooled WebSocket connection for transactions. Room writes take the tournament row lock, check active membership and engine inside the transaction, then persist the entry and audit event together. Official awards are projected from effective approved records. The separate admission guard controls room tournament creation. Canonical migrations and the application-owned transaction wrapper are intact.

| Observed code path or failure | Correction and regression evidence |
|---|---|
| Two first guest-code reads both reached the rotation upsert after finding no row. One reader could receive a code that the other immediately replaced. | Initialization inserts only on an empty slot and rereads on conflict. Concurrent first-use regression starts with no guest-code row. Explicit rotation and sharing revocation still pass. |
| JSON mutation origin checks treated a forwarded host as another independent authority and ignored the scheme. | Compare the full browser origin with configured APP_URL, or the request protocol and Host when unconfigured. Reject cross-site browser mutations. Valid-origin, denied-origin and Fetch Metadata cases exercise the handler. |
| The common API error handler logged the exception object. A disposable benchmark setup error demonstrated that Drizzle errors include query parameters. | Unexpected failures log only a generated reference and method. A regression checks the matching response reference and absence of a private marker on both sides. |
| Runtime pool checkout used the driver's unlimited default wait. | Set a 10-second acquisition budget. A saturated one-client driver pool with a shorter test budget rejects the waiter and then processes another transaction. |
| An idle wire disconnect causes the driver to emit an error after evicting that client. The runtime pool had no error listener. | Handle the notification without logging driver details. A fault-injection regression checks eviction and a subsequent successful transaction. The checkout and transaction cleanup algorithm is unchanged. |
| Staff writes could wait indefinitely, report a successful refresh after a failed read, or treat malformed HTTP 200 JSON as a successful receipt. Generic retry advice also covered non-idempotent decisions. | Staff reads and writes have a 15-second browser deadline. Unreadable success responses signal uncertainty. The workspace gives distinct recovery instructions for score receipts and decisions. Browser regression covers lost receipts, malformed JSON, duplicate clicks, retained request ID and recovery after reload. |

## Test inventory and coverage

The four required npm commands, both browser modes, the targeted scoring and assignment suites, and the benchmark exited successfully. During test development the pool mock needed an active event-loop handle to simulate an open socket, and the benchmark initially obtained the owner from a response that omits the owner ID. Both fixture issues were corrected and the affected checks rerun.

| Command | Evidence |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm run build` | Route types, TypeScript, ESLint, optimized Next.js build and route generation. |
| `npm test` | Installed-driver pool failure injection, development-target rejection, pilot identity pins, canonical migration install and refusal, scoring grants and refusal, admission and synthetic registration, accounts and sessions, legacy quiz, tournaments, room scoring schema, assignments, submissions, review, spectator, operations, lifecycle and adjudication. All database changes in these suites use disposable fixtures. |
| `node --conditions=react-server --import tsx scripts/test-score-submissions.mts` | Targeted scoring and integrity checks across championship, quiz-night, league and knockout. Includes handler-level authorization and local simultaneous service calls. |
| `node --conditions=react-server --import tsx scripts/test-room-assignments.mts` | Owner authorization, assignment conflicts, duplicate pairing saves, stale revisions and retained history. |
| `node --import tsx scripts/test-staff-browser.mts` and the same command with `--operations` | Headless Chromium with fixture HTTP responses. Staff confirmation loss, repeated taps, view switching, denied access, completion blockers, admin plan editor, release readiness and monitor. |
| `node --conditions=react-server --import tsx scripts/test-event-load.mts` | Bounded PGlite benchmark with assertions for submissions, standings totals and audit-event count. |

**Concurrency and reliability.** Local services exercised identical concurrent UUIDs, conflicting payloads with one UUID, independent valid and cross-room submissions, competing decisions, revocation during submission, competing correction proposals and injected audit-write interruption. Tests cover single effective awards, duplicate closure, stale plan/draw revisions and reopening versus downstream release. The installed Neon pool with a simulated wire client covered failed BEGIN, callback error, failed rollback, failed commit acknowledgment, failed commit plus rollback, healthy reuse and subsequent checkout. Disposal and release counts were asserted. PGlite serializes local transactions. These runs cannot quantify PostgreSQL row-lock waits, Neon transport failures, network partitions or independent-backend scheduling. The opt-in original-development Neon write suite and native PostgreSQL admission race suite were skipped. No disposable native PostgreSQL instance was available.

**Lifecycle and privacy.** The suites cover assigned rooms, authorized fixture release, question plans, pending submissions, independent review, replacement, correction, close/reopen/reclose, dependency rejection and versioned owner rulings including hold, resume, withdrawal and uphold. Prior disposable pilot-shaped rehearsal demonstrated Swiss Match 2 draft generation and rejection of premature release. Source and tests cover prerequisites for later Swiss rounds and knockout advancement, including unresolved results and ties. A complete real-device event from Match 1 through the final remains outstanding.

Spectator tests exercise code and UUID access, listed/unlisted discovery, code rotation, disabled sharing, room selection, room and overall totals, draw visibility, unreleased and completed fixtures, and exclusion of staff and private correction data. Pending and rejected scores do not enter official totals. Superseded awards yield to their approved replacements. Coverage combines service responses, legacy tournament tests and refresh-state fixtures. Public page rendering over venue Wi-Fi and real spectator device accessibility still require a dress rehearsal.

**Security review.** Registration, password hashing, login, reset, guest code and encrypted session handling were reviewed. Authenticated room handlers derive the actor from the session, check tournament/room assignments and separate judge submission from review. Owner operations check ownership. Tested room writes use parameterized Drizzle queries and validated scoring inputs. The runtime can write authorized scores but cannot administer the journal or bypass the append-only guard through application privileges. Authorization is enforced in the service within a shared runtime role, so runtime credential protection matters. This audit does not certify every deployed route or proxy configuration. The JSON origin change does not replace Next.js Server Action origin enforcement. Originless nonbrowser clients are supported.

Privileged sessions currently share the 30-day encrypted-cookie lifetime. Logout removes the local cookie; central revocation of an issued owner session was not established. Removing a room assignment takes effect on subsequent authorized operations. Rate-limit counting and recording are separate operations, and the visitor IP depends on ingress sanitation. Require trusted forwarding configuration, event-specific sign-in and lost-device procedures, and an effective privileged-session revocation decision before public use. Guest codes and UUIDs for shared sections are bearer links. Exclude them from logs and public incident notes.

**Operator usability.** The room workspace disables duplicate clicks and displays release context, pending decisions and completion blockers. Approving an award and completing a ready fixture each take one button press. The reviewer should read back the team, question and points before approval and check the coverage preview before closure. The response-loss changes distinguish an acknowledged write from a failed refresh. The mock browser verifies state transitions; touch accuracy on small phones, screen-reader use and recovery after a prolonged venue outage remain field checks.

## Bounded service measurements

Windows, Node 24.19, one in-process PGlite database, one synthetic championship, two scoring teams, three questions, and up to four simultaneous calls in each batch. Times are elapsed milliseconds including local scheduling and serialized database work. The process ran alongside other verification on this workstation.

| Service | Calls | p50 | p95 | Max | Errors |
|---|---:|---:|---:|---:|---:|
| Judge submission | 6 | 41 | 99 | 99 | 0 |
| Room-host approval | 6 | 35 | 80 | 80 | 0 |
| Public room/overall standings | 32 | 41 | 666 | 682 | 0 |
| Judge workspace | 24 | 40 | 69 | 80 | 0 |

Initial process RSS was 261 MiB and the sampled high was 494 MiB. PGlite shutdown took 4 ms. Both scored teams had six effective points and the benchmark recorded 12 audit events. The two six-sample write distributions give little information about tails. Service time includes queueing; independent lock wait, WAN latency, serverless cold start, peak audience, database growth and graceful shutdown with in-flight deployed requests remain unmeasured. Client and pool acquisition budgets do not bound an executing server transaction.

A second run of the same workload, alongside the final checks, again completed all 68 calls with zero errors. Its p50/p95/max in milliseconds were 179/458/458 for submissions, 271/689/689 for review, 99/200/233 for standings and 82/222/229 for staff. RSS was 258 MiB initially and peaked at 406 MiB in the samples. Shutdown took 16 ms. The variation between the two runs limits the precision of a single workstation measurement.

## Event decision and outstanding evidence

1. Run the event build on an isolated production-like deployment with a disposable PostgreSQL target and independent clients. Exercise overlapping A–H, downstream draws and staff replacement. Include long transactions, idle connection loss, lock and statement deadlines, cold start, process termination and ambiguous commits. Verify the final receipts and audit trail.
2. Set one canonical HTTPS APP_URL, validate Host and forwarded headers at trusted ingress, test sign-in and same-origin writes through the actual proxy, review rate limits and restrict setup credentials to operators. Agree how to expire privileged sessions and remove access from a lost device.
3. Use representative room, team, question and spectator counts with realistic polling. Record error rates, queue depth, connection counts, database lock wait, p95/p99 and memory over the event duration. Set event-specific latency and pause thresholds with operators.
4. Restore a backup into a separate target and reconcile entries, event chains, rulings and published results. Rehearse operator communication, mobile score entry in poor connectivity, accessible spectator views, staff replacement and emergency pause. Confirm monitoring and handoff ownership.
5. Obtain separate release approval once these checks pass. Use the [event operations runbook](EVENT_OPERATIONS.md) for staff and operator sign-off.

## Worktree change inventory

| Scope | Files |
|---|---|
| API, sharing and connection handling | `lib/api.ts`, `lib/tournament/store.ts`, `lib/db/index.ts`, `lib/db/pooled-transactions.ts` |
| Staff browser and JSON client | `components/host/room-workspace.tsx`, `components/quiz/api.ts` |
| Security, sharing, browser and transport regressions | `scripts/test-accounts.mts`, `scripts/test-tournament.mts`, `scripts/staff-browser-fixture.tsx`, `scripts/test-pooled-transactions.mts` |
| Scoring, assignment and lifecycle regressions | `scripts/test-score-submissions.mts`, `scripts/test-room-assignments.mts`, `scripts/score-review-checks.ts`, `scripts/adjudication-checks.ts`, `scripts/lifecycle-checks.ts` |
| New benchmark and operations documents | `scripts/test-event-load.mts`, `EVENT_OPERATIONS.md`, `EVENT_READINESS.md` |
