import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import type { Session } from "@/lib/auth/session";
import * as schema from "@/lib/db/schema";
import { requireActiveAssignment, requireRoomHost, requireRoomJudge } from "@/lib/tournament/room-access";
import { assignmentHandler, roomHandlers } from "@/lib/tournament/room-handlers";
import { changeRoom, listRoomSetup, saveRoomPairings, type RoomCommand } from "@/lib/tournament/room-management";
import { createTournament, readState, removeJudge, writeState } from "@/lib/tournament/store";

const pg = new PGlite();
const db = drizzle(pg, { schema });
try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  const accounts = await db.insert(schema.users).values(["owner", "judge", "host", "alternate", "historian"].map(name => ({
    name, email: name + "@example.test", password: "fixture", emailVerifiedAt: new Date(), role: name === "owner" ? "host" as const : "judge" as const,
  }))).returning();
  const [owner, judge, host, alternate, historian] = accounts.map(a => ({ userId: a.id, name: a.name, role: a.role }));
  async function tournament() {
    const made = await createTournament(db, owner.userId, { name: "Schools", category: "quiz", year: 2026 });
    assert.ok(made.ok);
    return made.value.id;
  }
  const id = await tournament();
  const other = await tournament();
  await db.insert(schema.tournamentJudges).values({ tournamentId: other, userId: judge.userId });
  let setup = await listRoomSetup(db, id, owner);
  async function change(command: RoomCommand) {
    setup = await changeRoom(db, id, owner, { command, revision: setup.revision });
  }
  await change({ action: "create", name: "East" });
  await change({ action: "create", name: "West" });
  const [east, west] = setup.rooms.map(r => r.id);
  const eastJudge = { action: "assign", roomId: east, role: "judge", email: accounts[1].email } as const;
  const westHost = { action: "assign", roomId: west, role: "room_host", email: accounts[2].email } as const;
  await change(eastJudge);
  await change(westHost);
  await change({ action: "rename", roomId: east, name: "Main Hall" });
  assert.equal(setup.rooms[0].id, east);
  await requireActiveAssignment(db, id, east, judge, "judge");
  await requireActiveAssignment(db, id, west, host, "room_host");
  await assert.rejects(requireActiveAssignment(db, id, west, judge, "judge"), { status: 403 });
  await assert.rejects(requireActiveAssignment(db, id, east, host, "room_host"), { status: 403 });
  await assert.rejects(requireActiveAssignment(db, id, west, owner, "room_host"), { status: 403 });
  await writeState(db, other, "rooms", setup.rooms);
  await assert.rejects(requireActiveAssignment(db, other, east, judge, "judge"), { status: 403 });
  await assert.rejects(requireRoomJudge(db, id, east, judge), { status: 409 });
  await assert.rejects(requireRoomHost(db, id, west, host), { status: 409 });
  console.log("ok  stable rename, scoped roles, cross-tournament isolation and disabled scoring");

  const label = { id: "name-only", name: judge.name, email: "", hasLogin: false };
  await writeState(db, id, "judges", [label]);
  await change({ action: "panel", roomId: west, judgeId: label.id, panelistIds: [] });
  assert.equal(setup.rooms.find(r => r.id === west)?.judgeId, label.id);
  await assert.rejects(requireActiveAssignment(db, id, west, judge, "judge"), { status: 403 });
  await assert.rejects(change({ ...eastJudge, email: "name-only@example.test" }), { status: 400 });
  await assert.rejects(changeRoom(db, id, judge, { revision: setup.revision, command: westHost }), { status: 404 });
  await assert.rejects(changeRoom(db, id, owner, { revision: setup.revision, command: { action: "rename", name: "Lost" } }), { status: 400 });
  await assert.rejects(changeRoom(db, id, owner, { revision: setup.revision, command: { action: "rename", roomId: east, id: west, name: "Replace" } }), { status: 400 });
  await writeState(db, other, "rooms", [setup.rooms[0], setup.rooms[0]]);
  await assert.rejects(listRoomSetup(db, other, owner), { status: 409 });
  await removeJudge(db, other, judge.userId);
  let viewer: Session | null = judge;
  const ownAssignment = assignmentHandler(() => db, async () => viewer);
  function checkRole(tournamentId: string, roomId: string, role: string) {
    return ownAssignment(new NextRequest("https://quizotab.test/assignment?role=" + role),
      { params: Promise.resolve({ id: tournamentId, roomId }) });
  }
  assert.equal((await checkRole(id, east, "judge")).status, 200);
  assert.equal((await checkRole(id, west, "judge")).status, 403);
  assert.equal((await checkRole(other, east, "judge")).status, 403);
  viewer = host;
  assert.equal((await checkRole(id, east, "room_host")).status, 403);
  assert.equal((await checkRole(id, west, "room_host")).status, 200);
  viewer = owner;
  assert.equal((await checkRole(id, west, "room_host")).status, 403);
  viewer = judge;
  const active = setup.assignments.find(a => a.roomId === east)!;
  await change({ action: "revoke", roomId: east, assignmentId: active.id });
  assert.equal((await checkRole(id, east, "judge")).status, 403);
  await assert.rejects(requireActiveAssignment(db, id, east, judge, "judge"), { status: 403 });
  await db.insert(schema.tournamentJudges).values({ tournamentId: other, userId: judge.userId });
  await removeJudge(db, other, judge.userId);
  assert.equal((await db.select().from(schema.users).where(eq(schema.users.id, judge.userId))).length, 1);
  console.log("ok  invalid identity and IDs rejected, same-session revocation, historical account retained");

  // Force a failure after the old host has been revoked, inside the same transaction.
  await pg.exec(`ALTER TABLE tournament_room_staff ADD CONSTRAINT fixture_refuse_replacement CHECK (user_id <> ${alternate.userId})`);
  const replacement = { ...westHost, email: accounts[3].email };
  await assert.rejects(change(replacement), /insert/i);
  await requireActiveAssignment(db, id, west, host, "room_host");
  await pg.exec("ALTER TABLE tournament_room_staff DROP CONSTRAINT fixture_refuse_replacement");
  const revision = setup.revision;
  const race = await Promise.allSettled([replacement, { ...westHost, email: accounts[1].email }].map(command =>
    changeRoom(db, id, owner, { revision, command })));
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  assert.ok(race.some(r => r.status === "rejected" && r.reason.status === 409));
  setup = await listRoomSetup(db, id, owner);
  assert.equal(setup.assignments.filter(a => a.roomId === west && a.role === "room_host").length, 1);
  console.log("ok  competing replacements, stale requests and rollback after failed insert");

  const pairing = { id: "match", stage: "preliminary" as const, matchLabel: "Match 1", teamAId: null, teamBId: null, roomId: east, released: true };
  const savePairing = () => db.transaction(tx => saveRoomPairings(tx, id, [pairing], []));
  const duplicates = await Promise.allSettled([savePairing(), savePairing()]);
  assert.equal(duplicates.filter(r => r.status === "fulfilled").length, 1);
  assert.ok(duplicates.some(r => r.status === "rejected" && r.reason.status === 409));
  await assert.rejects(change({ action: "delete", roomId: east }), { status: 409 });
  const { pairings } = await readState(db, id);
  await saveRoomPairings(db, id, [{ ...pairing, released: false }], pairings);
  const [team] = await db.insert(schema.teams).values({ tournamentId: id, name: "A" }).returning();
  for (const status of ["pending", "approved", "rejected", "superseded"] as const) {
    await change({ action: "create", name: status });
    const roomId = setup.rooms.at(-1)!.id;
    await db.insert(schema.tournamentScoreEntries).values({
      tournamentId: id, roomId, teamId: team.id, contextId: roomId, questionKey: "1", roundId: "r", points: 0, status,
      judgeUserId: historian.userId, clientRequestId: randomUUID(), reason: "fixture",
      ...(status === "pending" ? {} : { reviewerUserId: owner.userId, reviewedAt: new Date("2100-01-01") }),
    });
    await assert.rejects(change({ action: "delete", roomId }), { status: 409 });
  }
  await db.insert(schema.tournamentJudges).values({ tournamentId: other, userId: historian.userId });
  await removeJudge(db, other, historian.userId);
  assert.equal((await db.select().from(schema.users).where(eq(schema.users.id, historian.userId))).length, 1);
  await change(eastJudge);
  const raceRevision = setup.revision;
  const deletion = await Promise.allSettled([
    { action: "delete", roomId: east }, { ...eastJudge, email: accounts[3].email },
  ].map(command => changeRoom(db, id, owner, { revision: raceRevision, command })));
  assert.equal(deletion.filter(r => r.status === "fulfilled").length, 1);
  setup = await listRoomSetup(db, id, owner);
  if (setup.rooms.some(r => r.id === east)) await change({ action: "delete", roomId: east });
  assert.ok(!setup.assignments.some(a => a.roomId === east));
  assert.equal((await readState(db, id)).pairings[0].roomId, null);
  assert.ok((await db.select().from(schema.tournamentRoomStaff).where(eq(schema.tournamentRoomStaff.roomId, east))).every(a => a.revokedAt));
  console.log("ok  all score statuses, released draws, delete/assign race, draft cleanup and revocation history");

  const path = "https://quizotab.test/api/host/tournaments/" + id + "/rooms";
  const context = { params: Promise.resolve({ id }) };
  let session: Session | null = null;
  const handlers = roomHandlers(() => db, async () => session);
  const get = () => handlers.GET(new NextRequest(path), context);
  const post = () => handlers.POST(new NextRequest(path, { method: "POST", body: JSON.stringify({
    revision: setup.revision, command: { action: "assign", roomId: west, email: accounts[4].email, role: "judge" }, userId: owner.userId,
  }) }), context);
  assert.equal((await get()).status, 401);
  assert.equal((await post()).status, 401);
  session = judge;
  assert.equal((await get()).status, 404);
  assert.equal((await post()).status, 404);
  session = owner;
  assert.equal((await get()).status, 200);
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 409);
  console.log("ok  authenticated owner GET/POST, spoofed actor ignored, stale API retry rejected");
} finally {
  await pg.close();
}
