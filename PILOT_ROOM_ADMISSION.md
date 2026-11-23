# Pilot room admission v1

The upgrade targets only the independently pinned QuizoTab-Pilot installation of canonical migrations 0000 and 0001. It installs a closed policy with zero approved hosts. The legacy privilege profile still applies. Installing the policy, opening admission, granting scoring writes, and deploying the application are separate decisions.

## Installed pilot state on 23 November 2026

Stage 6E-D3C confirmed one installed `0001_room_admission` record on the independently pinned project `noisy-violet-99522280`, branch `br-restless-king-bdli89ow`, endpoint `ep-long-fog-bdc5rxjn`, database `quizotab_pilot`. The dedicated read-only post-upgrade verifier at commit `af0a237` exited 0 with `Verified pilot admission-verify completed.` Use `pilot:admission:v1:verify` for this installed state.

| Verified value | SHA-256 |
|---|---|
| Reviewed upgrade SQL and installed record | `d54a4e515c2c6464a7e610252f3f00e2049fa3af6f8ffb0662b3de4f314ffb7f` |
| Live catalog and committed post-upgrade fingerprint | `14699534914ebe61bdd9d0df77c9d0d6282979e2bf1fe2ca94cd4a3cacc16549` |

The npm logs record command start times and exit codes in the pilot worktree. The installation time comes from the database upgrade record. All times below are EAT (UTC+3) on 23 November 2026.

| Time | Observed event |
|---|---|
| 11:19:14 | Predecessor preflight started and exited 0. |
| 11:27:30 | A second predecessor preflight started and exited 0. |
| 11:28:35 | The upgrade command started and subsequently exited 0. |
| 11:28:43 | The database recorded installation at 11:28:43.310143 EAT. |
| 11:29:45 | The post-upgrade verifier started and exited 0. |
| 11:32:31 | A later predecessor preflight started and exited 1 at the schema fingerprint check. |

Stage 6E-D3A.1 compared the catalog rows and found the reviewed upgrade accounted for the entire difference. The 11:32 refusal therefore describes a check against an already upgraded database. The available logs establish the sequence and worktree. Attribution of the upgrade to a person or initiating process remains unresolved.

The policy is closed. A separate identity-checked read-only transaction confirmed zero allowlisted hosts, zero `room_v1` tournaments, zero relational score entries and zero score audit events. The always-enabled admission trigger enforces engine immutability, and the score-event append-only trigger is enabled. The canonical Drizzle journal still contains exactly migrations `0000` and `0001` with their approved hashes.

The legacy privilege profile has zero missing and zero excess privileges. The runtime role cannot administer admission, access the Drizzle journal, insert or update score entries, or insert audit events. The next decision is whether to authorize preparation of a room-scoring permission proposal. Applying grants and opening admission each require separate explicit approval.

## Closed upgrade procedure for the predecessor schema

After explicit live authorization, use the isolated pilot checkout and the existing external manifest and setup credential file. Run each command separately and check its exit status.

```powershell
npm run pilot:admission:v1:preflight -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\setup.env"
npm run pilot:admission:v1:upgrade -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\setup.env"
npm run pilot:admission:v1:verify -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\setup.env"
```

Preflight and verification use read-only transactions. All three commands validate both connection URLs, compare the manifest with the approved digest, probe all three adapters and recheck the direct setup identity inside the transaction. Schedule the change while other setup or administrative DDL and ACL changes are paused. The upgrade takes the pilot procedure lock and an exclusive tournament table lock, repeats preflight, installs the always-enabled trigger before removing the old constraint, records the upgrade digest and verifies the result before commit. A lock timeout or discrepancy aborts the transaction. The Drizzle journal continues to describe only the two canonical migrations.

The catalog fingerprints cover the canonical PostgreSQL definitions, including the enum, default, indexes, constraints, trigger functions and trigger state. Ownership and effective legacy privileges are checked separately. Changes in PostgreSQL catalog rendering can cause refusal. Investigate differences against a clean same-version local installation before proposing a verifier revision.

## Closure and recovery

### Controlled pilot-host commands

**Preparing the D5B account.** After separate authorization for account creation, use the operator launcher from the isolated checkout. The final argument explicitly selects the only supported address.

```powershell
npm run pilot:fixture:register -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\runtime.env" "room-host-d5b@pilot.invalid"
```

Open the private link printed in the local terminal and enter a unique pilot password saved outside Git. The link is a temporary credential. Keep it on the operator workstation, with no port forwarding or shared terminal logs. The listener binds to a random port on IPv4 loopback, expires after five minutes and accepts one registration attempt. The form takes only a password. The launcher fixes the display name to `QuizoTab Pilot D5B Synthetic Host` and checks the approved pilot target and runtime role again inside the registration transaction.

The normal registration service hashes the password and records the account as verified at creation. The fixture makes no email delivery or session-cookie call. Use the ordinary pilot login for subsequent authenticated work. A duplicate attempt preserves the existing account and password. If the response is lost, verify the exact account by a separate pinned read-only check before retrying. Account creation leaves host approval, allowlisting and opening admission as separate decisions.

Stage 6E-D5A prepares these commands for separate operator authorization. Run them from the isolated pilot checkout with the external pins and setup credential file. The CLI verifies the target and roles, and the direct setup transaction rechecks identity, the installed upgrade and catalog fingerprint, the journal, both triggers, ownership and the complete scoring privilege profile. The earlier scoring verifier expects a closed policy. The host verifier can inspect either policy state.

| npm script | Additional arguments after the pins and credentials | Result |
|---|---|---|
| `pilot:host:v1:preflight` | Host ID and absolute approval-file path | Read-only. Requires a matching persisted fixture, closed policy and empty allowlist. |
| `pilot:host:v1:add` | Same ID and approval file | Adds just that host and leaves admission closed. |
| `pilot:host:v1:open` | Same ID and approval file | Rechecks the persisted fixture and opens only for the single already-listed host. |
| `pilot:host:v1:verify` | None | Read-only. Reports the policy state and sole host ID, or null for an empty list. Compare the ID with the operator record. |
| `pilot:host:v1:close` | None | Closes the policy and removes the sole allowlist entry atomically. Existing tournaments and score history are retained. |
| `pilot:host:v1:verify-closed` | None | Read-only. Requires a closed policy and empty allowlist. |

For example, the read-only candidate check has this invocation:

```powershell
npm run pilot:host:v1:preflight -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\setup.env" "<approved-host-id>" "<absolute-approval-file-path>"
```

Before any allowlisting, the operator must confirm the synthetic account and its purpose against the pilot fixture creation record. Keep the approval JSON outside Git under operator control. Supply exactly four fields:

| Field | Required evidence |
|---|---|
| `purpose` | The operator explicitly attests to `synthetic-room-admission`. |
| `hostId` | Positive integer matching the separate CLI argument and the persisted user ID. |
| `email` | Exact synthetic fixture address under a reserved `.invalid` domain. |
| `createdAtUtc` | Exact creation instant from the fixture record, formatted as UTC with six fractional digits, e.g. `2026-01-01T00:00:00.000000Z`. |

The account must still have the host role. The add and open operations lock the matching account row and compare all identity fields. The operator's independent fixture record supplies provenance; an address suffix alone cannot establish who controls an account. Do not build the approval from an incoming application request or automatically select a retained account. Explicit approval is required for each future live action.

Administration writes serialize with the pilot procedure lock and lock both admission tables through commit. If a room creation already passed the guard, closure waits for it to finish. If closure obtains its locks first, the waiting creation sees the closed policy and fails. A lock timeout or failed check aborts the administration transaction.

After a lost response or interrupted connection, use `pilot:host:v1:verify` in a fresh process before deciding what to do. Closed with no host, closed with the approved ID, and open with the approved ID distinguish the three valid stages. Compare the observed state with the intended operation and any other authorized activity. An unexpected ID, schema or privilege failure needs investigation. After a close, also run `pilot:host:v1:verify-closed`. Closure leaves the full scoring privilege profile in place and permits historical reads. Retire the approval file when the rehearsal ends.

The setup-owned singleton controls new admission. Each allowed owner has a separate setup-owned host row. A room insert locks the enabled policy, the matching allowlist row and persisted host row for the transaction. A concurrent closure or revocation either waits for that creation to finish or prevents it from passing. Legacy inserts do not acquire policy locks. The application checks the signed-in host and the pinned runtime session before insertion. Engine changes and transfers of an existing room tournament are rejected by the database.

To stop admitting tournaments during an authorized rehearsal, use the guarded close and verify closure on a new connection. Existing tournaments, score entries and append-only events remain readable under their ordinary access rules. Closing admission does not revoke a later scoring grant or stop operations on admitted tournaments. Handle any such grants separately. Reinstalling the old unconditional constraint after admitting a room tournament would conflict with retained records.

A failure before commit rolls back the entire upgrade. If the connection fails during commit, resolve the outcome with the independent read-only verifier and preflight before considering another write. A partial or unknown schema requires investigation. The upgrade refuses to resume or overwrite it.

## Boundaries and local evidence

The shared application database role and disabled RLS mean PostgreSQL cannot identify the signed-in human. A holder of that credential can act within its effective ACLs and could name an allowlisted host in a direct insert during an open period. Keep credentials isolated, authorize room operations on the server and limit any future opening to reviewed hosts and a controlled interval. Setup and database administrators remain trusted. The runtime receives neither the setup credential nor access to policy administration.

`npm test` runs the PGlite upgrade, restricted-role, route-handler and server-page regressions alongside existing tournament and room authorization suites. The separate two-backend test takes a PostgreSQL binary directory, creates and stops its own password-protected loopback cluster and accepts no connection URL.

```powershell
node --import tsx scripts/test-pilot-admission-race.mjs "<local PostgreSQL bin directory>"
```
