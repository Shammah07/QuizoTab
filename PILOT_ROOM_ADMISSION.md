# Pilot room admission v1

The upgrade targets only the independently pinned QuizoTab-Pilot installation of canonical migrations 0000 and 0001. It installs a closed policy with zero approved hosts. The legacy privilege profile still applies. Installing the policy, opening admission, granting scoring writes, and deploying the application are separate decisions.

## Closed upgrade procedure

After explicit live authorization, use the isolated pilot checkout and the existing external manifest and setup credential file. Run each command separately and check its exit status.

```powershell
npm run pilot:admission:v1:preflight -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\setup.env"
npm run pilot:admission:v1:upgrade -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\setup.env"
npm run pilot:admission:v1:verify -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\setup.env"
```

Preflight and verification use read-only transactions. All three commands validate both connection URLs, compare the manifest with the approved digest, probe all three adapters and recheck the direct setup identity inside the transaction. Schedule the change while other setup or administrative DDL and ACL changes are paused. The upgrade takes the pilot procedure lock and an exclusive tournament table lock, repeats preflight, installs the always-enabled trigger before removing the old constraint, records the upgrade digest and verifies the result before commit. A lock timeout or discrepancy aborts the transaction. The Drizzle journal continues to describe only the two canonical migrations.

The catalog fingerprints cover the canonical PostgreSQL definitions, including the enum, default, indexes, constraints, trigger functions and trigger state. Ownership and effective legacy privileges are checked separately. Changes in PostgreSQL catalog rendering can cause refusal. Investigate differences against a clean same-version local installation before proposing a verifier revision.

## Closure and recovery

The setup-owned singleton controls new admission. Each allowed owner has a separate setup-owned host row. A room insert locks the enabled policy, the matching allowlist row and persisted host row for the transaction. A concurrent closure or revocation either waits for that creation to finish or prevents it from passing. Legacy inserts do not acquire policy locks. The application checks the signed-in host and the pinned runtime session before insertion. Engine changes and transfers of an existing room tournament are rejected by the database.

If a future authorized rehearsal needs to stop admitting tournaments, the setup operator closes the singleton in a transaction, confirms it is closed and runs the read-only verifier on a new connection. Existing tournaments, score entries and append-only events remain readable under their ordinary access rules. Closing admission does not revoke a later scoring grant or stop operations on admitted tournaments. Handle any such grants separately. Reinstalling the old unconditional constraint after admitting a room tournament would conflict with retained records.

A failure before commit rolls back the entire upgrade. If the connection fails during commit, resolve the outcome with the independent read-only verifier and preflight before considering another write. A partial or unknown schema requires investigation. The upgrade refuses to resume or overwrite it.

## Boundaries and local evidence

The shared application database role and disabled RLS mean PostgreSQL cannot identify the signed-in human. A holder of that credential can act within its effective ACLs and could name an allowlisted host in a direct insert during an open period. Keep credentials isolated, authorize room operations on the server and limit any future opening to reviewed hosts and a controlled interval. Setup and database administrators remain trusted. The runtime receives neither the setup credential nor access to policy administration.

`npm test` runs the PGlite upgrade, restricted-role, route-handler and server-page regressions alongside existing tournament and room authorization suites. The separate two-backend test takes a PostgreSQL binary directory, creates and stops its own password-protected loopback cluster and accepts no connection URL.

```powershell
node --import tsx scripts/test-pilot-admission-race.mjs "<local PostgreSQL bin directory>"
```
