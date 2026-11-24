# Running a QuizoTab room event

Use this checklist with an event lead, a tournament owner, a judge and an independent reviewer per room, and an operator who can reconcile the database. Record the event, tournament ID, time zone, people on duty and incident contact before distributing links.

## Before competitors arrive

1. **Operator, read only.** Check the checkout, commit and release manifest. For the isolated pilot, run the following from the pilot checkout. Compare the independent project, branch, endpoint, database and both roles with the approved manifest. Stop on mismatch, drift, an unexpected open policy or a listed host. Keep the setup file outside the application environment.

   `npm run pilot:host:v1:verify-closed -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\setup.env"`

2. **Deployment operator.** For a real event, independently verify the intended production target and runtime identity under its own approved release procedure. Pilot pins and pilot-only tooling apply only to the isolated pilot. Confirm HTTPS, canonical APP_URL, trusted ingress, secret separation, backup restoration, monitoring and the rollback owner. Record rehearsal latency and agree on intervention thresholds at expected audience size.
3. **Owner, authorized setup.** Confirm the intended scoring engine at creation, year, format, rounds, order, point bounds and tie rules. Register each team once. Agree room names with the physical venue. Record both team IDs on the score sheets. Keep Match 2 as a draft until Match 1 evidence supports advancement.
4. **Owner and room staff.** Verify the actual account and active assignment for each room and role. Panel labels alone do not authorize scoring. Each judge and reviewer signs in separately and opens their own room from `/staff`. Compare the displayed room, role, fixture and teams with the paper schedule. Store credentials individually.
5. **Owner, authorized release.** Inspect the configured question keys and ranges for every required round. Confirm both assignments, registered participants, correct pairing/roster, active tournament and release-readiness preview. Resolve blockers and refresh after conflicts. Release only the checked fixture. Each room confirms it can see the released competition on its device.
6. **Spectator lead, read only.** From a signed-out device open the intended public link/code. Check listing, permitted sections, room selection, draw and standings against the owner view. An unlisted UUID is shareable. Rotating the guest code retires that code while the UUID still works for enabled sections. Disabling sharing is the control for removing public views. Make changes only with owner approval.

## During a round

| Who | Action and evidence |
|---|---|
| Judge | Select the released fixture, team, round and question. Read back points, submit once, then check the pending entry in the room history. Retain the signed score sheet. |
| Room host | Compare the pending row with the score sheet. Approve or reject using the assigned reviewer account. Record a specific rejection reason. A different authorized staff member must review the submitter's score. |
| Judge and reviewer | For a rejected score, propose the replacement against the latest rejected attempt. For an approved award, propose a correction against the effective award with a reason. The existing approved value counts until the replacement is approved. Check the revision chain and official total afterward. |
| Event lead | Monitor pending count and age, missing slots, duplicate reports, stale screens, official totals by room, refresh failures, response latency, 409s and 5xxs. Collect timestamp, room, fixture, actor ID and request/entry/reference ID. Keep cookies, passwords, access codes and raw database errors out of incident records. |
| Room host | Inspect completion coverage. Missing questions, pending reviews or corrections need resolution. Resolve from paper evidence. Zero is a scored answer and requires evidence like any other award. Refresh the preview, complete, then verify the fixture marker and result. |
| Owner | Verify all prerequisite fixtures are closed, check winners/ties and independently read the official standings. Generate the next draft, check entrants, rooms, staff and question coverage again before releasing. A stale revision requires rereading and comparing the current draw. |
| Owner handling a dispute | Open an eligible case, check source score, impact and downstream draw. Review the current version, record a reason, and use the permitted hold, resume, withdraw or uphold action. Check ruling history and any remaining reviewer action. Reopening requires the authorized owner, a reason and a fresh lifecycle preview. Recheck downstream dependencies before reclosure. |

## When a room loses connectivity

1. Pause entries in that room, retain the paper sequence and record the last acknowledged score. Keep the original browser tab. A timeout, disconnect or unreadable response leaves the write outcome uncertain. The browser deadline does not cancel a database commit.
2. Refresh the room after connectivity returns. Inspect history, pending queue, score ID and revision. If still uncertain, the operator reads entries and events using the verified read-only target, tournament, judge and original request UUID. Compare room, fixture, round, team, question and points. One matching entry and submission event identifies the receipt. Escalate conflicting payloads, multiple matches, missing events or an unavailable database.
3. If a submission is conclusively absent after the original operation has settled, the same judge may retry the identical details in the original tab with the retained request ID. Decisions, rulings, release and completion have their own state and revision rules. Reconcile each one before acting. Never replay a batch of writes after a lost response.
4. If coverage remains incomplete, hold progression, preserve the outstanding slot list and hand the paper record to the event lead. To replace staff, the owner refreshes room setup, revokes the exact assignment, assigns the verified replacement and checks the replacement's workspace. Keep the historical actor identities. Inspect any in-flight decisions at the handoff.

## Emergency control and shutdown

**Safe check.** Use `npm run pilot:host:v1:verify -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\setup.env"` from a fresh process. Capture admission state and host ID.

**Separately authorized pilot action.** For emergency closure use `npm run pilot:host:v1:close -- "C:\QuizoTabPilot\pins.json" "C:\QuizoTabPilot\setup.env"`. Run the read-only `verify-closed` command above from a fresh process. Closure gates creation and empties the allowlist. Existing tournaments can still receive authorized scores. To suspend ongoing activity, coordinate the staff pause and stop the controlled launcher if necessary. If closure cannot be verified, keep the launcher stopped and escalate to the operator with the last observed state.

**End of event.** Collect every room's coverage, closure marker and pending/dispute list. Reconcile effective awards against the official room and tournament totals and the append-only event chain. Compare the published view with the approved final results. Record outstanding rulings, retained fixtures and responsible operators. Sign out shared devices, verify the event listener has stopped where applicable, and retain restricted backups and recovery evidence under the event owner's retention policy. Archive or change sharing only under separate owner authorization.
