# QuizoTab pilot application permissions

## Runtime matrix

Each operation applies to the named public table. An asterisk means all columns. A dash means no privilege. The final column explains each service dependency. The SQL below covers all implemented paths, including the dormant relational score writers.

| Table | SELECT | INSERT | UPDATE | DELETE | Application use |
|---|---|---|---|---|---|
| app_settings | — | — | — | — | No runtime service uses this table. |
| auth_tokens | user_id, purpose, token_hash, expires_at, used_at, created_at | all | used_at | — | Look up and count tokens, issue verification/reset tokens and retire them. |
| guest_codes | tournament_id, code, code_key | all | code, code_key, created_at | — | Resolve spectator links, issue a code, rotate it by upsert. |
| payments | — | — | — | — | Tournament creation currently skips payment processing. |
| quiz_answers | game_id, player_id, question_index, choice, correct, points | game_id, player_id, question_index, choice, correct, points, answered_ms | — | — | Read per-question results and atomically record a unique answer. The raw scoring CTE also reads its RETURNING columns. |
| quiz_games | all | all | version, status, current_index, question_started_at, question_ends_at, tournament_id, tournament_label, scores_sent_at | — | Create and read games, advance host state, mark score export and detach a deleted tournament. |
| quiz_players | all | all | kicked, score, streak | — | Join, authenticate, rank, kick and update points and streak in the answer CTE. |
| quiz_solo_runs | id, quiz_id, nickname, token_hash, current_index, question_opened_at, score, correct_count, finished_at | all | score, correct_count, current_index, question_opened_at, finished_at | — | Create practice runs, look up player tokens, score, advance and rank finished runs. |
| quizzes | all | all | title, description, category, category_label, is_public, questions, updated_at, plays | yes | Create, discover, edit and delete owned quizzes, and count solo plays. |
| rate_limits | all | all | — | yes | Count attempts, record attempts and prune old attempts. |
| teams | all | all | name, category, members | yes | Register, list, edit, remove and reset teams. Fixture checks also lock roster rows. |
| tournament_judges | all | all | — | yes | Check legacy assignment, attach and remove a judge login. |
| tournament_room_staff | all | all | revoked_at | — | Assign room staff, check authorization, and revoke or replace via timestamp. |
| tournament_score_entries | all | all | status, reviewer_user_id, reviewed_at, reason | — | Read dependencies, queue, history and approved standings. Dormant services insert submissions and correction revisions, decide reviews and supersede prior awards. |
| tournament_score_events | all | all | — | — | Idle-judge cleanup checks historical actor references. Dormant services append submission, decision and supersession events. |
| tournament_state | all | all | value, updated_at | — | Read configuration and standings, upsert room/draw/legacy score documents, record closure, reopening and adjudication rulings. |
| tournaments | all | all | name, start_date, end_date | yes | Read and lock tournaments, create explicitly in legacy mode, edit details and delete eligible owned tournaments. |
| users | id, name, email, password, role, email_verified_at | all | password, email_verified_at | yes | Register hosts and legacy judges, authenticate, verify/reset accounts, resolve staff and delete unreferenced legacy judge logins. |

## Proposed grant statements for review

Apply only after separate authorization in an independently verified pilot setup transaction. The active legacy pilot can omit INSERT on tournament_score_events and both INSERT and UPDATE on tournament_score_entries. Keep SELECT on both tables for existing reads. The full list includes the requested audit recording permissions.

```sql
GRANT SELECT (user_id, purpose, token_hash, expires_at, used_at, created_at), INSERT, UPDATE (used_at)
  ON TABLE public.auth_tokens TO quizotab_pilot_app;

GRANT SELECT (tournament_id, code, code_key), INSERT, UPDATE (code, code_key, created_at)
  ON TABLE public.guest_codes TO quizotab_pilot_app;

GRANT SELECT (game_id, player_id, question_index, choice, correct, points), INSERT (game_id, player_id, question_index, choice, correct, points, answered_ms)
  ON TABLE public.quiz_answers TO quizotab_pilot_app;

GRANT SELECT, INSERT, UPDATE (version, status, current_index, question_started_at, question_ends_at, tournament_id, tournament_label, scores_sent_at)
  ON TABLE public.quiz_games TO quizotab_pilot_app;

GRANT SELECT, INSERT, UPDATE (kicked, score, streak)
  ON TABLE public.quiz_players TO quizotab_pilot_app;

GRANT SELECT (id, quiz_id, nickname, token_hash, current_index, question_opened_at, score, correct_count, finished_at), INSERT, UPDATE (score, correct_count, current_index, question_opened_at, finished_at)
  ON TABLE public.quiz_solo_runs TO quizotab_pilot_app;

GRANT SELECT, INSERT, UPDATE (title, description, category, category_label, is_public, questions, updated_at, plays), DELETE
  ON TABLE public.quizzes TO quizotab_pilot_app;

GRANT SELECT, INSERT, DELETE
  ON TABLE public.rate_limits TO quizotab_pilot_app;

GRANT SELECT, INSERT, UPDATE (name, category, members), DELETE
  ON TABLE public.teams TO quizotab_pilot_app;

GRANT SELECT, INSERT, DELETE
  ON TABLE public.tournament_judges TO quizotab_pilot_app;

GRANT SELECT, INSERT, UPDATE (revoked_at)
  ON TABLE public.tournament_room_staff TO quizotab_pilot_app;

GRANT SELECT
  ON TABLE public.tournament_score_entries TO quizotab_pilot_app;

GRANT SELECT
  ON TABLE public.tournament_score_events TO quizotab_pilot_app;

GRANT SELECT, INSERT, UPDATE (value, updated_at)
  ON TABLE public.tournament_state TO quizotab_pilot_app;

GRANT SELECT, INSERT, UPDATE (name, start_date, end_date), DELETE
  ON TABLE public.tournaments TO quizotab_pilot_app;

GRANT SELECT (id, name, email, password, role, email_verified_at), INSERT, UPDATE (password, email_verified_at), DELETE
  ON TABLE public.users TO quizotab_pilot_app;
```

The preceding block is the proposed legacy pilot grant set. These additional statements cover the implemented room-scoring writers and require a separate decision.

```sql
GRANT INSERT, UPDATE (status, reviewer_user_id, reviewed_at, reason)
  ON TABLE public.tournament_score_entries TO quizotab_pilot_app;
GRANT INSERT ON TABLE public.tournament_score_events TO quizotab_pilot_app;
```

Drizzle emits explicit insert column lists, including defaulted fields. Its full-row SELECTs, RETURNING projections and the idle-judge NOT EXISTS subqueries also affect read privileges. The legacy judge cleanup in lib/tournament/store.ts uses an unqualified Drizzle select() in its event subquery, expanding to every mapped event column even though its predicate only uses actor_user_id. Narrowing that SELECT would require an application change. The raw answer INSERT in lib/quiz/engine.ts names seven columns and can use column-scoped privileges. Existing FK actions handle cascades without runtime DELETE on every child.

## Stage 6E-D4A room-scoring permission procedure

The two statements in the second SQL block are the full change from the verified legacy profile. `room-scoring.ts` inserts an entry and its submission event. `score-review.ts` inserts correction revisions, updates the four listed decision columns, supersedes an earlier award by updating its status, and inserts decision and supersession events. Drizzle names all mapped insertable columns, including defaulted ones. Existing SELECT privileges cover lookups and RETURNING. Events remain append-only.

The following commands target the independently pinned pilot. Stage 6E-D4A authorizes preparation and local tests. A live preflight and application are a separate operator decision.

```powershell
npm run pilot:scoring:v1:preflight -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\setup.env"
npm run pilot:scoring:v1:apply -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\setup.env"
npm run pilot:scoring:v1:verify -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\setup.env"
```

Preflight requires the exact legacy profile, the installed closed admission policy, an empty allowlist and zero room tournaments, score entries and events. Apply repeats those checks inside the direct setup transaction, acquires the pilot procedure lock and locks the admission and scoring tables used for readiness checks. Run it during a pause in other administrative ACL or DDL work. It issues the two reviewed grants and rechecks the complete permission matrix, ownership, protected schemas, journal, upgrade hash and trigger definitions before commit. A failed check aborts the transaction. Admission and staff authorization remain separate from database privileges.

After an interrupted connection, run the scoring verifier in a new process. It checks the closed policy, reports data counts, and classifies effective permissions. A verified `full` result with zero missing and zero excess establishes that the approved privileges are present. A verified `legacy` result establishes that the prior profile is still in effect. A partial or excessive profile or any failed protection check exits nonzero and requires investigation. Resolve the result before considering any retry. Apply refuses a full or partial baseline. The original admission verifier continues to require the legacy privilege profile.

The shared runtime credential and disabled RLS place per-tournament authorization in the application. The scoring grants permit direct writes within their SQL scope even while admission is closed. Any subsequent opening or host approval requires its own authorization. Recovery is read-only. If scoring data already exists, retain it and review its dependencies before considering any separately authorized privilege change.

## Privilege boundaries

Existing CONNECT on quizotab_pilot and PUBLIC USAGE on public cover connection and name lookup. The eight public sequences belong to identity columns. Generated identity defaults and INSERT RETURNING need no direct sequence privileges. The serial sequence in drizzle belongs exclusively to migration bookkeeping. The application calls no nextval, currval or setval.

The engine uses ordinary pg_catalog functions, operators and aggregates for identity probes, UUID defaults, clocks, intervals, JSON, constraints and standings. The sole application function, public.prevent_tournament_score_event_changes(), runs as an existing trigger. PUBLIC currently has EXECUTE on it. It is an invoker-rights trigger function and direct calls cannot perform an audit mutation. No new EXECUTE is needed. No grants on other functions, languages, types, sequences, the journal, future objects or schemas are proposed.

All application tables and journal objects are owned by quizotab_pilot_setup. Keep the application role outside the setup, owner and administrative roles. It needs neither grant options nor database/schema CREATE, TEMP, REFERENCES, MAINTAIN, TRIGGER, TRUNCATE or a session_replication_role override. Existing legacy-only and append-only protections remain prerequisites. Run the companion catalog queries as the verified setup role before and after any separately approved change.

## Live audit and decision

On 23 November 2026 the direct setup session passed the pinned project, branch, endpoint, database, login and effective-role checks. The PostgreSQL 18.7 transaction reported read_only=on and was rolled back. All 18 public tables and the journal had empty effective runtime table permissions, no explicit column ACLs and RLS off. The runtime role had no memberships beyond itself, no privileged role attributes, no TEMP, no MAINTAIN and no SET on session_replication_role. Both canonical journal hashes matched. The validated legacy check and enabled statement trigger covering UPDATE, DELETE and TRUNCATE were present. No executable SECURITY DEFINER routine was found in a schema accessible to runtime. No required built-in name checked had an inaccessible overload. Existing per-creator default ACL entries concerned cloud_admin and neon_superuser.

GO for separate approval of the first SQL block for the legacy pilot. Defer the second block unless the authorization explicitly includes dormant score writes. The application test suite was not exercised under the proposed grants. This audit inspected source, emitted-query conventions and live catalogs. The role is shared by application requests. Database ACLs cannot bind a row to a signed-in judge or host, and the checked tables have no RLS. Users DELETE can cascade to dependent records. An audit INSERT can fabricate a new event even though committed history is immutable. The legacy constraint gates tournaments and does not itself prohibit direct SQL inserts into scoring tables. Updates to tournament_state.value can rewrite JSON scoring, room, lifecycle and adjudication data. These are material reasons to protect the runtime credential and defer dormant writes.

For any approved application, use a fresh identity-verified direct setup transaction, rerun the read-only catalog checks, execute only the approved block(s), then run the checks again before commit. Require zero missing and zero excess in the selected profile, both original journal hashes, intact trigger and gate, expected owners, no extra role memberships, and no prohibited object, column or sequence grants. Roll back on a discrepancy. Catalog verification does not substitute for a separately authorized runtime rehearsal.
