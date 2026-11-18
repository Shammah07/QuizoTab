// Checks the tournament backend (create, teams, scores and approval, judges, sharing, the pairing
// engine, and live quiz scores flowing into a round) against a throwaway Postgres that runs inside
// this script, with the real migrations applied. Run with: npm test
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { verifyPassword } from "@/lib/auth/password";
import * as schema from "@/lib/db/schema";
import { advance, gameById, join, launch } from "@/lib/quiz/engine";
import { ownQuiz, saveQuiz } from "@/lib/quiz/quizzes";
import { hostTournaments, sendScores, tournamentTeams } from "@/lib/quiz/tournament-link";
import {
  advanceKnockout,
  computeStandings,
  configProblem,
  defaultConfig,
  generateFirstKnockout,
  generateKnockoutDraw,
  generateMatch1Pairings,
  generateSwissPairings,
  isTiedNeedingBreak,
  matchWinnerDetail,
  normalizeConfig,
  preliminarySeedOrder,
  todayStatus,
  type Team,
} from "@/lib/tournament/rules";
import {
  addJudge,
  addTeam,
  applyScoreOp,
  createTournament,
  deleteTeam,
  deleteTournament,
  guestCodeFor,
  hostView,
  isJudgeFor,
  listOwnTournaments,
  loadTeams,
  newGuestCode,
  ownTournament,
  publicView,
  readState,
  removeJudge,
  resetTournament,
  saveConfig,
  saveSharing,
  tournamentForGuestCode,
  updateTeam,
} from "@/lib/tournament/store";

// Guest codes are fingerprinted with the server secret; the test uses one of its own
process.env.HMAC_SECRET ??= "test-secret-for-guest-codes";

const db = drizzle(new PGlite(), { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

let passed = 0;
async function check(name: string, run: () => Promise<void> | void) {
  await run();
  passed++;
  console.log("ok  " + name);
}
function value<R extends { ok: true; value: unknown } | { ok: false; error: string }>(result: R): Extract<R, { ok: true }>["value"] {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const error = (result: { ok: boolean; error?: string }) => {
  assert.equal(result.ok, false);
  return result.error;
};

const [asha] = await db.insert(schema.users).values({ name: "Asha Mrema", email: "asha@example.com", password: "x", emailVerifiedAt: new Date() }).returning();
const [baraka] = await db.insert(schema.users).values({ name: "Baraka", email: "baraka@example.com", password: "x", emailVerifiedAt: new Date() }).returning();

let tournamentId = "";
const teamIds: Record<string, string> = {};

await check("rules: configs are normalised and checked", () => {
  const config = normalizeConfig({ name: "  Lake Zone  ", format: "nonsense", rounds: [{ name: "R1", stage: "quiz" }], maxScorePerRound: "50", qualificationCount: 5 });
  assert.equal(config.format, "championship");
  assert.equal(config.qualificationCount, 8);
  assert.equal(config.maxScorePerRound, 50);
  assert.equal(config.rounds.length, 1);
  assert.ok(config.rounds[0].id);
  assert.equal(configProblem(config), null);
  assert.equal(configProblem({ ...config, name: " " }), "Give your tournament a name.");
  assert.match(configProblem({ ...config, rounds: [{ ...config.rounds[0], minPoints: 60, maxPoints: 10 }] })!, /Check the points/);
  // A config without rounds gets its format's starting rounds
  assert.equal(normalizeConfig({ format: "quiz-night" }).rounds.length, 6);
  assert.equal(defaultConfig("league").rounds.length, 8);
  assert.equal(todayStatus({ startDate: "2026-01-01", endDate: "2026-01-03" }, "2026-01-02"), "live");
  assert.equal(todayStatus({ startDate: "2026-01-01", endDate: "2026-01-03" }, "2026-01-04"), "ended");
  assert.equal(todayStatus({ startDate: "", endDate: "" }), "unscheduled");
});

await check("creating a tournament checks its details and stores its documents", async () => {
  assert.equal(error(await createTournament(db, asha.id, { name: "", category: "Quiz", year: 2026 })), "Enter a tournament name, category, and year.");
  assert.equal(error(await createTournament(db, asha.id, { name: "X", category: "Quiz", year: 2026, startDate: "2026-03-02", endDate: "2026-03-01" })), "The end date is before the start date.");

  const created = value(await createTournament(db, asha.id, { name: "Lake Zone Schools Quiz", category: "Senior Quiz", year: 2026, startDate: "2026-03-01", endDate: "2026-03-03", format: "championship" }));
  tournamentId = created.id;
  const state = await readState(db, tournamentId);
  assert.equal(state.config.name, "Lake Zone Schools Quiz");
  assert.equal(state.config.format, "championship");
  assert.equal(state.config.rounds.length, 19);
  assert.deepEqual(state.scores, []);
  assert.equal(state.sharing.listed, false);
  assert.equal((await listOwnTournaments(db, asha.id)).length, 1);
  assert.equal(await ownTournament(db, tournamentId, baraka.id), null);
  // The quiz link sees the same config
  assert.equal((await hostTournaments(db, asha.id))[0].rounds.length, 19);
});

await check("saving settings updates the row the lists show", async () => {
  const { config } = await readState(db, tournamentId);
  await saveConfig(db, tournamentId, { ...config, name: "Lake Zone Quiz 2026", startDate: "2026-04-01", endDate: "" });
  const [t] = await listOwnTournaments(db, asha.id);
  assert.equal(t.name, "Lake Zone Quiz 2026");
  assert.equal(t.startDate, "2026-04-01");
  assert.equal(t.endDate, null);
});

await check("teams: added, renamed, no duplicate names, removed with their scores", async () => {
  for (const name of ["Kibaha", "Mzumbe", "Tabora Boys", "Msalato Girls"]) teamIds[name] = value(await addTeam(db, tournamentId, { name, category: "Secondary" }, "Asha")).id;
  assert.equal(error(await addTeam(db, tournamentId, { name: "  kibaha " }, "Asha")), "A team with that name already exists.");
  assert.equal(error(await addTeam(db, tournamentId, { name: " " }, "Asha")), "Enter the team's name.");
  assert.equal(error(await updateTeam(db, tournamentId, teamIds.Mzumbe, { name: "Kibaha" })), "A team with that name already exists.");
  assert.equal(value(await updateTeam(db, tournamentId, teamIds.Mzumbe, { name: "Mzumbe Secondary", category: "", members: "4" })).members, "4");
  const extra = value(await addTeam(db, tournamentId, { name: "Extra" }, "Asha"));
  const { config } = await readState(db, tournamentId);
  value(await applyScoreOp(db, tournamentId, { op: "enter", teamId: extra.id, roundId: config.rounds[0].id, points: 10 }, { name: "Asha", isHost: true }));
  assert.equal(await deleteTeam(db, tournamentId, extra.id), true);
  assert.equal((await loadTeams(db, tournamentId)).length, 4);
  assert.equal((await readState(db, tournamentId)).scores.length, 0);
});

await check("scores: judges' entries wait for approval, the host's count at once", async () => {
  const { config } = await readState(db, tournamentId);
  const round = config.rounds[0];
  assert.equal(error(await applyScoreOp(db, tournamentId, { op: "enter", teamId: teamIds.Kibaha, roundId: round.id, points: 101 }, { name: "Neema", isHost: false })), "Points for this round must be between 0 and 100.");
  assert.equal(error(await applyScoreOp(db, tournamentId, { op: "enter", teamId: teamIds.Kibaha, roundId: "nope", points: 10 }, { name: "Neema", isHost: false })), "Choose a round.");

  const judged = value(await applyScoreOp(db, tournamentId, { op: "enter", teamId: teamIds.Kibaha, roundId: round.id, points: 80 }, { name: "Neema", isHost: false }));
  assert.equal(judged[0].approved, false);
  assert.equal(judged[0].judgeName, "Neema");
  // The same team and round again replaces the entry
  const again = value(await applyScoreOp(db, tournamentId, { op: "enter", teamId: teamIds.Kibaha, roundId: round.id, points: 85 }, { name: "Neema", isHost: false }));
  assert.equal(again.length, 1);
  assert.equal(again[0].points, 85);

  const hosted = value(await applyScoreOp(db, tournamentId, { op: "enter", teamId: teamIds.Mzumbe, roundId: round.id, points: 70 }, { name: "Asha", isHost: true }));
  assert.equal(hosted.find((s) => s.teamId === teamIds.Mzumbe)!.approved, true);

  // Only the host approves or removes
  assert.equal(error(await applyScoreOp(db, tournamentId, { op: "approve-round", roundId: round.id, approved: true }, { name: "Neema", isHost: false })), "Only the host can approve or remove scores.");
  const pub = await publicView(db, tournamentId ? (await ownTournament(db, tournamentId, asha.id))! : null!);
  assert.deepEqual(pub.scores.map((s) => s.teamId), [teamIds.Mzumbe]);

  const approved = value(await applyScoreOp(db, tournamentId, { op: "approve-round", roundId: round.id, approved: true }, { name: "Asha", isHost: true }));
  assert.ok(approved.every((s) => s.approved));
  const fewer = value(await applyScoreOp(db, tournamentId, { op: "delete", scoreId: approved[0].id }, { name: "Asha", isHost: true }));
  assert.equal(fewer.length, 1);
});

await check("standings and the pairing engine", async () => {
  const teams = await loadTeams(db, tournamentId);
  const { config } = await readState(db, tournamentId);
  const prelim = config.rounds.filter((r) => r.stage === "preliminary");
  const scores = teams.flatMap((team, i) => prelim.map((round) => ({ id: `${team.id}-${round.id}`, teamId: team.id, roundId: round.id, points: (i + 1) * 10, judgeName: "Asha", enteredAt: "", approved: true })));
  const standings = computeStandings(teams, scores, prelim);
  assert.equal(standings[0].name, "Msalato Girls");
  assert.equal(standings[0].total, 240);

  const match1 = generateMatch1Pairings(teams, "Match 1");
  assert.equal(match1.length, 2);
  assert.ok(match1.every((p) => p.teamAId && p.teamBId && !p.released));
  const match2 = generateSwissPairings("Match 2", teams, config, scores, match1);
  // Paired by standing, avoiding repeat opponents: the leader doesn't meet their match 1 opponent again
  const leaderMatch1 = match1.find((p) => p.teamAId === standings[0].id || p.teamBId === standings[0].id)!;
  const leaderMatch2 = match2.find((p) => p.teamAId === standings[0].id || p.teamBId === standings[0].id)!;
  const opponent = (p: typeof leaderMatch1) => (p.teamAId === standings[0].id ? p.teamBId : p.teamAId);
  assert.notEqual(opponent(leaderMatch1), opponent(leaderMatch2));

  // Top 4 qualify: best seed against worst in the semi finals
  const four = { ...config, qualificationCount: 4 };
  assert.equal(preliminarySeedOrder(teams, four, scores).length, 4);
  const semis = generateFirstKnockout(teams, four, scores);
  assert.equal(semis.length, 2);
  assert.equal(semis[0].stage, "semi-final");
  assert.equal(semis[0].teamAId, standings[0].id);
  assert.equal(semis[0].teamBId, standings[3].id);

  // A tied semi final waits for the tiebreaker, then the final is made from the winners
  const semiRounds = config.rounds.filter((r) => r.stage === "semi-final");
  const tied = [
    { id: "t1", teamId: semis[0].teamAId!, roundId: semiRounds[0].id, points: 50, judgeName: "", enteredAt: "", approved: true },
    { id: "t2", teamId: semis[0].teamBId!, roundId: semiRounds[0].id, points: 50, judgeName: "", enteredAt: "", approved: true },
    { id: "t3", teamId: semis[1].teamAId!, roundId: semiRounds[0].id, points: 60, judgeName: "", enteredAt: "", approved: true },
    { id: "t4", teamId: semis[1].teamBId!, roundId: semiRounds[0].id, points: 20, judgeName: "", enteredAt: "", approved: true },
  ];
  assert.equal(isTiedNeedingBreak(semis[0], config, tied), true);
  assert.equal(matchWinnerDetail(semis[0], config, tied).winnerId, null);
  const broken = { ...semis[0], tiebreakWinnerId: semis[0].teamBId };
  assert.deepEqual(matchWinnerDetail(broken, config, tied), { winnerId: semis[0].teamBId, viaTiebreak: true });
  const final = advanceKnockout("semi-final", "final", preliminarySeedOrder(teams, four, scores), config, tied, [broken, semis[1]]);
  assert.equal(final.length, 1);
  assert.deepEqual([final[0].teamAId, final[0].teamBId].sort(), [semis[0].teamBId, semis[1].teamAId].sort());

  // A knockout cup of five teams starts at the quarter finals with three byes
  const five: Team[] = [...teams, { id: "x", name: "Fifth", category: "", members: "", registeredBy: "", createdAt: "" }];
  const draw = generateKnockoutDraw(five);
  assert.equal(draw.length, 4);
  assert.equal(draw[0].stage, "quarter-final");
  assert.equal(draw.filter((p) => !p.teamBId).length, 3);
});

let judgeId = "";
await check("judges: a login tied to the tournament, removed when it judges nothing else", async () => {
  assert.equal(error(await addJudge(db, tournamentId, { name: "Neema", email: "not-an-email", password: "longenough" })), "Enter a valid email address for the judge.");
  assert.equal(error(await addJudge(db, tournamentId, { name: "Neema", email: "neema@example.com", password: "short" })), "The password needs at least 8 characters.");
  // A host's account can't be turned into a judge
  assert.equal(error(await addJudge(db, tournamentId, { name: "B", email: "baraka@example.com", password: "longenough" })), "This email already belongs to another account. Use a different email for the judge.");

  const { judge, existing } = value(await addJudge(db, tournamentId, { name: "Neema K.", email: "Neema@Example.com", password: "judge-pass-1" }));
  judgeId = judge.id;
  assert.equal(existing, false);
  assert.equal(judge.email, "neema@example.com");
  assert.equal(judge.hasLogin, true);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, Number(judge.id)));
  assert.equal(user.role, "judge");
  assert.ok(await verifyPassword("judge-pass-1", user.password));
  assert.equal(await isJudgeFor(db, tournamentId, user.id), true);
  assert.equal(await isJudgeFor(db, tournamentId, baraka.id), false);
  assert.deepEqual((await readState(db, tournamentId)).judges.map((j) => j.name), ["Neema K."]);

  // The same judge added to a second tournament keeps their password
  const second = value(await createTournament(db, asha.id, { name: "Quiz Night", category: "Staff", year: 2026, format: "quiz-night" }));
  const added = value(await addJudge(db, second.id, { name: "Neema", email: "neema@example.com", password: "another-pass" }));
  assert.equal(added.existing, true);
  assert.ok(await verifyPassword("judge-pass-1", (await db.select().from(schema.users).where(eq(schema.users.id, user.id)))[0].password));

  await removeJudge(db, second.id, judgeId);
  assert.equal((await db.select().from(schema.users).where(eq(schema.users.id, user.id))).length, 1); // still judges the first one
  await removeJudge(db, tournamentId, judgeId);
  assert.equal((await db.select().from(schema.users).where(eq(schema.users.id, user.id))).length, 0);
  assert.deepEqual((await readState(db, tournamentId)).judges, []);
  await deleteTournament(db, second.id, asha.id);
});

await check("sharing: a guest code per tournament, found only once the tournament is listed", async () => {
  const code = await guestCodeFor(db, tournamentId);
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(await guestCodeFor(db, tournamentId), code);
  assert.equal(await tournamentForGuestCode(db, code), null);

  assert.equal(error(await saveSharing(db, tournamentId, { listed: true, showStandings: false, showDraw: false })), "Share at least the standings or the draw.");
  const sharing = value(await saveSharing(db, tournamentId, { listed: true, showStandings: true, showDraw: false, about: "Six schools." }));
  assert.equal(sharing.showDraw, false);
  const found = await tournamentForGuestCode(db, code.toLowerCase());
  assert.equal(found?.tournament.id, tournamentId);
  assert.equal(found?.sharing.about, "Six schools.");

  const fresh = await newGuestCode(db, tournamentId);
  assert.notEqual(fresh, code);
  assert.equal(await tournamentForGuestCode(db, code), null);
  assert.equal((await tournamentForGuestCode(db, fresh))?.tournament.id, tournamentId);
});

await check("a live quiz's results land in the round, waiting for approval", async () => {
  const saved = value(await saveQuiz(db, asha.id, { title: "Warm-up", questions: [{ text: "2+2?", answers: ["3", "4"], correct: 1, time: 10, points: 1 }] }));
  const quiz = (await ownQuiz(db, saved.id, asha.id))!;
  const { config } = await readState(db, tournamentId);
  const round = config.rounds[1];
  const teams = await tournamentTeams(db, tournamentId);
  const id = value(await launch(db, quiz, asha.id, { tournamentId, roundId: round.id, label: "Lake Zone Quiz, Match 1 Round 2", teams }));
  let game = (await gameById(db, id))!;
  value(await join(db, game, null, teams[0].id));
  game = value(await advance(db, game, "start"));
  game = value(await advance(db, (await gameById(db, id))!, "end"));
  assert.equal(await sendScores(db, game), null);
  const { scores } = await readState(db, tournamentId);
  const sent = scores.find((s) => s.roundId === round.id);
  assert.equal(sent?.teamId, teams[0].id);
  assert.equal(sent?.approved, false);
  assert.equal(sent?.judgeName, "Online quiz");
});

await check("the host's view, a reset, and deleting the tournament", async () => {
  const tournament = (await ownTournament(db, tournamentId, asha.id))!;
  const view = await hostView(db, tournament);
  assert.equal(view.teams.length, 4);
  assert.ok(view.code);
  assert.equal(view.sharing.listed, true);

  await resetTournament(db, tournamentId);
  const after = await hostView(db, tournament);
  assert.deepEqual([after.teams, after.scores, after.pairings], [[], [], []]);
  assert.equal(after.config.rounds.length, 19);

  value(await addJudge(db, tournamentId, { name: "Juma", email: "juma@example.com", password: "judge-pass-2" }));
  assert.equal(await deleteTournament(db, tournamentId, baraka.id), false);
  assert.equal(await deleteTournament(db, tournamentId, asha.id), true);
  assert.equal(await ownTournament(db, tournamentId, asha.id), null);
  assert.equal((await db.select().from(schema.tournamentState)).length, 0);
  assert.equal((await db.select().from(schema.users).where(eq(schema.users.email, "juma@example.com"))).length, 0);
  // The quiz game that sent scores is unlinked, not deleted
  const [game] = await db.select().from(schema.quizGames);
  assert.equal(game.tournamentId, null);
});

console.log(`\n${passed} checks passed`);
