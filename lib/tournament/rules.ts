// The tournament rules: formats, rounds, standings and the pairing engine. No database here, so the
// host's browser and the server agree on what a tournament looks like.
// Moved over from the tournament app in ../Quiz Web (utilis/gemini-code-updated.js).

// ---------- Shapes of the tournament_state documents ----------

export const FORMATS = {
  championship: {
    label: "Championship",
    who: "Schools, universities and large contests",
    how: "Teams meet in preliminary matches, then the top teams play knockouts to the final.",
    hasDraw: true,
  },
  "quiz-night": {
    label: "Quiz night",
    who: "Companies, team building, churches and youth groups",
    how: "Every team plays every round. One leaderboard crowns the winner at the end.",
    hasDraw: false,
  },
  league: {
    label: "League",
    who: "Clubs and workplace leagues",
    how: "Teams play rounds week after week. A running table ranks them all season.",
    hasDraw: false,
  },
  knockout: {
    label: "Knockout cup",
    who: "Any group, big or small",
    how: "A random draw. Each match winner goes through until one team is left.",
    hasDraw: true,
  },
} as const;

export type Format = keyof typeof FORMATS;
export const FORMAT_KEYS = Object.keys(FORMATS) as Format[];

export const KNOCKOUT_STAGES = ["round-of-32", "round-of-16", "quarter-final", "semi-final", "final"] as const;
export type KnockoutStage = (typeof KNOCKOUT_STAGES)[number];
export type Stage = "preliminary" | KnockoutStage | "quiz" | "league";
export const STAGES: Stage[] = ["preliminary", ...KNOCKOUT_STAGES, "quiz", "league"];

export const STAGE_LABELS: Record<Stage, string> = {
  preliminary: "Preliminary rounds",
  "round-of-32": "Round of 32",
  "round-of-16": "Round of 16",
  "quarter-final": "Quarter finals",
  "semi-final": "Semi finals",
  final: "Grand finale",
  quiz: "Quiz rounds",
  league: "League",
};

const KNOCKOUT_SHORT: Record<KnockoutStage, string> = { "round-of-32": "R32", "round-of-16": "R16", "quarter-final": "QF", "semi-final": "SF", final: "Final" };

export const QUALIFY_OPTIONS = [2, 4, 8, 16] as const;

export type Round = {
  id: string;
  stage: Stage;
  // "Match 1" for preliminary rounds and "Week 1" for league rounds; null elsewhere
  match: string | null;
  name: string;
  // A round's own points range; blank means "use the tournament's max points per round"
  minPoints?: number | "";
  maxPoints?: number | "";
};

export type TournamentConfig = {
  setupDone: boolean;
  name: string;
  startDate: string;
  endDate: string;
  format: Format;
  maxScorePerRound: number;
  qualificationCount: number;
  conflictAvoidance: string;
  pairingMethod: string;
  rounds: Round[];
};

export type Score = {
  id: string;
  teamId: string;
  roundId: string;
  points: number;
  judgeName: string;
  enteredAt: string;
  approvedAt?: string;
  // Only approved scores count in the public standings
  approved: boolean;
};

export type Pairing = {
  id: string;
  stage: Stage;
  matchLabel: string | null;
  teamAId: string | null;
  teamBId: string | null;
  released: boolean;
  roomId?: string | null;
  // Set by the host after a Category of Choice tiebreaker decides a tied knockout match
  tiebreakWinnerId?: string | null;
};

export type Room = { id: string; name: string; judgeId: string; panelistIds: string[] };

// id is the judge's user id as text (rooms point at it), or a made-up id for a name-only judge
export type Judge = { id: string; name: string; email: string; hasLogin: boolean };

export type Team = { id: string; name: string; category: string; members: string; registeredBy: string; createdAt: string };

export type Sharing = { listed: boolean; showStandings: boolean; showDraw: boolean; about: string };

export type TournamentRow = {
  id: string;
  name: string;
  category: string;
  year: number;
  startDate: string | null;
  endDate: string | null;
  status: "draft" | "active" | "archived";
  createdAt: string;
};

export const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- Names and dates ----------

export function tournamentTitle(tournament: Pick<TournamentRow, "name" | "category"> | null, fallback = "Tournament") {
  if (!tournament) return fallback;
  return tournament.name.trim() || tournament.category.trim() || fallback;
}

// The category and year, unless the name already says them
export function tournamentSubtitle(tournament: Pick<TournamentRow, "name" | "category" | "year"> | null) {
  if (!tournament) return "";
  const title = tournamentTitle(tournament);
  const category = tournament.category.trim();
  const year = tournament.year && !title.includes(String(tournament.year)) ? String(tournament.year) : "";
  return [category !== title ? category : "", year].filter(Boolean).join(" · ");
}

export function tournamentLabel(tournament: Pick<TournamentRow, "name" | "category" | "year"> | null) {
  if (!tournament) return "No tournament selected";
  const subtitle = tournamentSubtitle(tournament);
  return subtitle ? `${tournamentTitle(tournament)} · ${subtitle}` : tournamentTitle(tournament);
}

export function formatDateRange(start: string, end: string) {
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const one = (date: string) => new Date(date + "T00:00:00").toLocaleDateString("en-GB", { ...options, year: "numeric" });
  if (!start && !end) return "Dates not set yet";
  if (!end) return `Starts ${one(start)}`;
  if (!start) return `Ends ${one(end)}`;
  return `${new Date(start + "T00:00:00").toLocaleDateString("en-GB", options)} – ${one(end)}`;
}

export type Status = "live" | "upcoming" | "ended" | "unscheduled";
export const STATUS_LABELS: Record<Status, string> = { live: "Live", upcoming: "Upcoming", ended: "Ended", unscheduled: "Not scheduled" };

export function todayStatus(config: Pick<TournamentConfig, "startDate" | "endDate"> | null, today = new Date().toISOString().slice(0, 10)): Status {
  if (!config || (!config.startDate && !config.endDate)) return "unscheduled";
  if (config.startDate && today < config.startDate) return "upcoming";
  if (config.endDate && today > config.endDate) return "ended";
  return "live";
}

// ---------- Formats and rounds ----------

export const formatOf = (config: { format?: string } | null | undefined): Format => (config?.format && config.format in FORMATS ? (config.format as Format) : "championship");

// Formats where every team plays every round and a single points table decides the winner
export const isPointsFormat = (config: { format?: string } | null | undefined) => ["quiz-night", "league"].includes(formatOf(config));

// The championship structure, matched to the official rubric
const ROUND_TEMPLATE: Array<Omit<Round, "id">> = [
  { stage: "preliminary", match: "Match 1", name: "Round 1: Categories" },
  { stage: "preliminary", match: "Match 1", name: "Round 2: Written Puzzle Questions" },
  { stage: "preliminary", match: "Match 2", name: "Round 1: Brain Maze Questions" },
  { stage: "preliminary", match: "Match 2", name: "Round 2: East African Knowledge" },
  { stage: "preliminary", match: "Match 3", name: "Round 1: Categories" },
  { stage: "preliminary", match: "Match 3", name: "Round 2: Conquer the Clue Questions" },
  { stage: "quarter-final", match: null, name: "Round 1: Category Selection" },
  { stage: "quarter-final", match: null, name: "Round 2: Pictorial Round" },
  { stage: "quarter-final", match: null, name: "Round 3: Categories (Death Wish Zone)" },
  { stage: "quarter-final", match: null, name: "Round 4: Quickfire Questions" },
  { stage: "semi-final", match: null, name: "Round 1: Mental Arithmetic" },
  { stage: "semi-final", match: null, name: "Round 2: Think, Don't Know" },
  { stage: "semi-final", match: null, name: "Round 3: Hot Seat" },
  { stage: "semi-final", match: null, name: "Round 4: Visual Intelligence" },
  { stage: "final", match: null, name: "Round 1: Fork in the Road" },
  { stage: "final", match: null, name: "Round 2: Spelling Bee" },
  { stage: "final", match: null, name: "Round 3: Memory Challenge" },
  { stage: "final", match: null, name: "Round 4: Multimedia & Entertainment" },
  { stage: "final", match: null, name: "Round 5: Echo Effect" },
];

// The knockout stage that starts with this many teams
export function firstKnockoutStage(teamCount: number): KnockoutStage {
  if (teamCount > 16) return "round-of-32";
  if (teamCount > 8) return "round-of-16";
  if (teamCount > 4) return "quarter-final";
  if (teamCount > 2) return "semi-final";
  return "final";
}

export function knockoutStagesFrom(stage: KnockoutStage): KnockoutStage[] {
  const start = KNOCKOUT_STAGES.indexOf(stage);
  return KNOCKOUT_STAGES.slice(start < 0 ? 2 : start);
}

function knockoutLabels(stage: KnockoutStage, count: number) {
  return Array.from({ length: count }, (_, i) => (stage === "final" ? "Final" : `${KNOCKOUT_SHORT[stage]} ${i + 1}`));
}

export const plainRounds = (stage: Stage, count: number, match: string | null = null): Round[] =>
  Array.from({ length: count }, (_, i) => ({ id: uid(), stage, match, name: `Round ${i + 1}` }));

// Starting rounds for each format; hosts can add, remove and rename them afterwards
export function formatRounds(format: Format): Round[] {
  if (format === "quiz-night") {
    return ["General knowledge", "Picture round", "Music", "Sport", "Current affairs", "Final round"].map((topic, i) => ({ id: uid(), stage: "quiz", match: null, name: `Round ${i + 1}: ${topic}` }));
  }
  if (format === "league") return [1, 2, 3, 4].flatMap((week) => plainRounds("league", 2, `Week ${week}`));
  if (format === "knockout") return (["round-of-16", "quarter-final", "semi-final", "final"] as const).flatMap((stage) => plainRounds(stage, 2));
  return ROUND_TEMPLATE.map((round) => ({ id: uid(), ...round }));
}

export const defaultConfig = (format: Format = "championship", name = "Quiz Tournament"): TournamentConfig => ({
  setupDone: true,
  name,
  startDate: "",
  endDate: "",
  format,
  maxScorePerRound: format === "quiz-night" ? 10 : 100,
  qualificationCount: 8,
  conflictAvoidance: "one-up-one-down",
  pairingMethod: "fold",
  rounds: formatRounds(format),
});

const MAX_ROUNDS = 80;
const text = (value: unknown, max: number) => (typeof value === "string" ? [...value.trim()].slice(0, max).join("") : "");
const isoDate = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "");
const points = (value: unknown): number | "" => (value === "" || value === null || value === undefined ? "" : Number.isFinite(Number(value)) ? Number(value) : "");

// Whatever is stored (or sent by the host's browser) becomes a complete, well-formed config.
// Saved rounds keep their ids: scores point at them, so a renamed round keeps its scores.
export function normalizeConfig(input: unknown): TournamentConfig {
  const raw = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const format = formatOf(raw as { format?: string });
  const rounds: Round[] = Array.isArray(raw.rounds)
    ? raw.rounds
        .filter((round): round is Record<string, unknown> => Boolean(round) && typeof round === "object")
        .slice(0, MAX_ROUNDS)
        .map((round) => ({
          id: typeof round.id === "string" && round.id ? round.id.slice(0, 80) : uid(),
          stage: STAGES.includes(round.stage as Stage) ? (round.stage as Stage) : format === "quiz-night" ? "quiz" : format === "league" ? "league" : "preliminary",
          match: typeof round.match === "string" && round.match ? round.match.slice(0, 40) : null,
          name: text(round.name, 120),
          minPoints: points(round.minPoints),
          maxPoints: points(round.maxPoints),
        }))
    : [];
  const qualification = Number(raw.qualificationCount);
  return {
    setupDone: raw.setupDone !== false,
    name: text(raw.name, 120),
    startDate: isoDate(raw.startDate),
    endDate: isoDate(raw.endDate),
    format,
    maxScorePerRound: Math.max(1, Math.min(100000, Math.round(Number(raw.maxScorePerRound)) || 100)),
    qualificationCount: (QUALIFY_OPTIONS as readonly number[]).includes(qualification) ? qualification : 8,
    conflictAvoidance: typeof raw.conflictAvoidance === "string" ? raw.conflictAvoidance.slice(0, 40) : "one-up-one-down",
    pairingMethod: typeof raw.pairingMethod === "string" ? raw.pairingMethod.slice(0, 40) : "fold",
    rounds: rounds.length ? rounds : formatRounds(format),
  };
}

// The first thing wrong with a config the host wants to save, or null
export function configProblem(config: TournamentConfig): string | null {
  if (!config.name.trim()) return "Give your tournament a name.";
  if (config.startDate && config.endDate && config.endDate < config.startDate) return "The end date is before the start date.";
  if (config.rounds.some((round) => !round.name.trim())) return "Every round needs a name.";
  const bad = config.rounds.find((round) => {
    const r = roundRange(config, round);
    return r.min < 0 || r.max < 1 || r.min > r.max;
  });
  if (bad) return `Check the points for "${bad.name}": the minimum must be 0 or more and no higher than the maximum.`;
  return null;
}

export function roundRange(config: Pick<TournamentConfig, "rounds" | "maxScorePerRound">, roundOrId: Round | string | undefined) {
  const round = typeof roundOrId === "string" ? config.rounds.find((r) => r.id === roundOrId) : roundOrId;
  const fallbackMax = Number(config.maxScorePerRound) || 100;
  const min = round?.minPoints !== "" && round?.minPoints != null && Number.isFinite(Number(round.minPoints)) ? Number(round.minPoints) : 0;
  const max = round?.maxPoints !== "" && round?.maxPoints != null && Number.isFinite(Number(round.maxPoints)) ? Number(round.maxPoints) : fallbackMax;
  return { min, max };
}

export type RoundGroup = { key: string; label: string; items: Round[] };

export function groupRoundsForDisplay(rounds: Round[]): RoundGroup[] {
  const groups: RoundGroup[] = [];
  const byKey = new Map<string, RoundGroup>();
  for (const round of rounds) {
    const key = `${round.stage}::${round.match || ""}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: round.match ? `${STAGE_LABELS[round.stage]} · ${round.match}` : STAGE_LABELS[round.stage], items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(round);
  }
  return groups;
}

// The preliminary match labels in order ("Match 1", "Match 2", ...)
export function prelimMatches(config: Pick<TournamentConfig, "rounds">) {
  const labels: string[] = [];
  for (const round of config.rounds) {
    if (round.stage === "preliminary" && round.match && !labels.includes(round.match)) labels.push(round.match);
  }
  return labels;
}

// Adds starting rounds for a knockout stage that has none yet (a big knockout cup can need a Round of 32)
export function withStageRounds(config: TournamentConfig, stage: KnockoutStage): TournamentConfig {
  if (config.rounds.some((round) => round.stage === stage)) return config;
  const at = config.rounds.findIndex((round) => KNOCKOUT_STAGES.indexOf(round.stage as KnockoutStage) > KNOCKOUT_STAGES.indexOf(stage));
  const rounds = [...config.rounds];
  rounds.splice(at < 0 ? rounds.length : at, 0, ...plainRounds(stage, 2));
  return { ...config, rounds };
}

// One line describing how a tournament runs, from its own settings
export function formatSummary(config: TournamentConfig) {
  const format = formatOf(config);
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : word.endsWith("ch") ? "es" : "s"}`;
  if (format === "quiz-night") return `${count(config.rounds.length, "round")} · every team plays every round · one leaderboard`;
  if (format === "league") {
    const weeks = new Set(config.rounds.map((r) => r.match)).size;
    return `${count(weeks, "week")} · ${count(config.rounds.length, "round")} in total · running league table`;
  }
  if (format === "knockout") return "Random draw · byes for uneven numbers · winners go through to the final";
  const stages = knockoutStagesFrom(firstKnockoutStage(config.qualificationCount || 8)).map((stage) => STAGE_LABELS[stage]);
  return `${count(prelimMatches(config).length, "preliminary match")} → top ${config.qualificationCount || 8} qualify → ${stages.join(" → ")}`;
}

// ---------- The other documents ----------

const str = (value: unknown, max = 80) => (typeof value === "string" ? value.slice(0, max) : "");
const idOrNull = (value: unknown) => (typeof value === "string" && value ? value.slice(0, 80) : null);
const objects = (input: unknown, max: number) => (Array.isArray(input) ? input.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").slice(0, max) : []);

export function normalizeScores(input: unknown): Score[] {
  return objects(input, 20000)
    .map((s) => ({
      id: str(s.id) || uid(),
      teamId: str(s.teamId),
      roundId: str(s.roundId),
      points: Number(s.points) || 0,
      judgeName: str(s.judgeName, 120),
      enteredAt: str(s.enteredAt, 40),
      ...(s.approvedAt ? { approvedAt: str(s.approvedAt, 40) } : {}),
      approved: s.approved === true,
    }))
    .filter((s) => s.teamId && s.roundId);
}

export function normalizePairings(input: unknown): Pairing[] {
  return objects(input, 2000).map((p) => ({
    id: str(p.id) || uid(),
    stage: STAGES.includes(p.stage as Stage) ? (p.stage as Stage) : "preliminary",
    matchLabel: idOrNull(p.matchLabel),
    teamAId: idOrNull(p.teamAId),
    teamBId: idOrNull(p.teamBId),
    released: p.released === true,
    roomId: idOrNull(p.roomId),
    tiebreakWinnerId: idOrNull(p.tiebreakWinnerId),
  }));
}

export function normalizeRooms(input: unknown): Room[] {
  return objects(input, 200).map((room) => ({
    id: str(room.id),
    name: str(room.name, 80),
    judgeId: str(room.judgeId),
    panelistIds: Array.isArray(room.panelistIds) ? room.panelistIds.filter((id): id is string => typeof id === "string").slice(0, 20) : [],
  }));
}

export function normalizeJudges(input: unknown): Judge[] {
  return objects(input, 200).map((judge) => ({
    id: str(judge.id) || uid(),
    name: str(judge.name, 120),
    email: str(judge.email, 255),
    hasLogin: judge.hasLogin === true,
  }));
}

export function normalizeSharing(input: unknown): Sharing {
  const raw = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  return {
    listed: raw.listed === true,
    showStandings: raw.showStandings !== false,
    showDraw: raw.showDraw !== false,
    about: text(raw.about, 280),
  };
}

export const approvedScores = (scores: Score[]) => scores.filter((score) => score.approved);

export function preliminaryScoresApproved(config: TournamentConfig, scores: Score[]) {
  const prelim = new Set(config.rounds.filter((round) => round.stage === "preliminary").map((round) => round.id));
  const entries = scores.filter((score) => prelim.has(score.roundId));
  return entries.length > 0 && entries.every((score) => score.approved);
}

// ---------- Standings ----------

export type Standing = Team & { byRound: Record<string, number>; total: number };

export type Award = Pick<Score, "teamId" | "roundId" | "points">;
export function computeStandings<T extends Pick<Team, "id" | "name">>(teams: T[], scores: Award[], rounds: Round[]) {
  const roundIds = new Set(rounds.map((r) => r.id));
  return teams
    .map((team) => {
      const byRound: Record<string, number> = {};
      let total = 0;
      for (const score of scores) {
        if (score.teamId !== team.id || !roundIds.has(score.roundId)) continue;
        byRound[score.roundId] = score.points;
        total += score.points;
      }
      return { ...team, byRound, total };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

// Rounds belonging to one match or stage. Preliminary rounds are scoped per match; a knockout stage
// shares one round set across all of its matches.
export function stageRoundsFor(config: Pick<TournamentConfig, "rounds">, stage: Stage, matchLabel: string | null) {
  if (stage === "preliminary") return config.rounds.filter((r) => r.stage === "preliminary" && r.match === matchLabel);
  return config.rounds.filter((r) => r.stage === stage);
}

export function roundsForPairings(config: Pick<TournamentConfig, "rounds">, pairings: Pairing[], releasedOnly = false) {
  const roundIds = new Set<string>();
  for (const pairing of pairings) {
    if (releasedOnly && !pairing.released) continue;
    for (const round of stageRoundsFor(config, pairing.stage, pairing.matchLabel)) roundIds.add(round.id);
  }
  return config.rounds.filter((round) => roundIds.has(round.id));
}

const STAGE_ORDER: Stage[] = ["preliminary", ...KNOCKOUT_STAGES];

export function pairingGroupRank(pairing: Pairing) {
  const stageRank = STAGE_ORDER.indexOf(pairing.stage);
  const matchRank = pairing.stage === "preliminary" ? Number(String(pairing.matchLabel || "").replace(/\D/g, "")) || 0 : 0;
  return stageRank * 100 + matchRank;
}

// The latest match or stage that has pairings
export function currentPairings(pairings: Pairing[], releasedOnly = false) {
  const eligible = pairings.filter((pairing) => !releasedOnly || pairing.released);
  const highest = Math.max(...eligible.map(pairingGroupRank), -1);
  if (highest < 0) return [];
  return eligible.filter((pairing) => pairingGroupRank(pairing) === highest);
}

export const releasedRounds = (config: TournamentConfig, pairings: Pairing[]) => roundsForPairings(config, pairings, true);

export function teamPointsIn(teamId: string, rounds: Round[], scores: Award[]) {
  const ids = new Set(rounds.map((r) => r.id));
  return scores.filter((s) => s.teamId === teamId && ids.has(s.roundId)).reduce((sum, s) => sum + s.points, 0);
}

// Winner of a paired match: whoever scored more across that match's rounds. A tie defers to the
// recorded Category of Choice tiebreak (pairing.tiebreakWinnerId) rather than guessing.
export function matchWinnerDetail(pairing: Pairing, config: TournamentConfig, scores: Award[]) {
  if (!pairing.teamAId || !pairing.teamBId) return { winnerId: pairing.teamAId || pairing.teamBId || null, viaTiebreak: false }; // a bye
  const rounds = stageRoundsFor(config, pairing.stage, pairing.matchLabel);
  const a = teamPointsIn(pairing.teamAId, rounds, scores);
  const b = teamPointsIn(pairing.teamBId, rounds, scores);
  if (a === b) return { winnerId: pairing.tiebreakWinnerId || null, viaTiebreak: Boolean(pairing.tiebreakWinnerId) };
  return { winnerId: a > b ? pairing.teamAId : pairing.teamBId, viaTiebreak: false };
}

export const matchWinner = (pairing: Pairing, config: TournamentConfig, scores: Award[]) => matchWinnerDetail(pairing, config, scores).winnerId;

// A knockout match tied on points, with at least one score entered and no tiebreak recorded yet
export function isTiedNeedingBreak(pairing: Pairing, config: TournamentConfig, scores: Award[]) {
  if (!pairing.teamAId || !pairing.teamBId || pairing.tiebreakWinnerId) return false;
  const rounds = stageRoundsFor(config, pairing.stage, pairing.matchLabel);
  const ids = new Set(rounds.map((r) => r.id));
  const hasAny = scores.some((s) => (s.teamId === pairing.teamAId || s.teamId === pairing.teamBId) && ids.has(s.roundId));
  if (!hasAny) return false;
  return teamPointsIn(pairing.teamAId, rounds, scores) === teamPointsIn(pairing.teamBId, rounds, scores);
}

// ---------- The pairing engine ----------
// Preliminary: controlled Swiss-style pairing (rematch avoidance, paired by cumulative standing
// after each match). Knockouts: power-protected (fold) seeding, winners advancing on points
// scored within that match's own rounds.

function shuffle<T>(list: T[]) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// The first match has no standings to pair by yet, so teams are paired at random
export function generateMatch1Pairings(teams: Team[], matchLabel = "Match 1"): Pairing[] {
  const shuffled = shuffle(teams);
  const pairings: Pairing[] = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    pairings.push({ id: uid(), stage: "preliminary", matchLabel, teamAId: shuffled[i].id, teamBId: shuffled[i + 1]?.id ?? null, released: false });
  }
  return pairings;
}

// Later matches: pair by cumulative standing, walking forward from each unpaired team to the
// nearest standing they haven't already faced (the "one-up-one-down" swap of a controlled Swiss system)
export function generateSwissPairings(matchLabel: string, teams: Team[], config: TournamentConfig, scores: Award[], existing: Pairing[]): Pairing[] {
  const order = prelimMatches(config);
  const priorMatches = order.slice(0, order.indexOf(matchLabel));
  const priorRounds = priorMatches.flatMap((m) => stageRoundsFor(config, "preliminary", m));

  const standings = [...teams].sort((a, b) => {
    const diff = teamPointsIn(b.id, priorRounds, scores) - teamPointsIn(a.id, priorRounds, scores);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });

  const priorOpponents = new Map(teams.map((t) => [t.id, new Set<string>()]));
  for (const p of existing) {
    if (p.stage !== "preliminary" || !priorMatches.includes(p.matchLabel ?? "")) continue;
    if (p.teamAId && p.teamBId) {
      priorOpponents.get(p.teamAId)?.add(p.teamBId);
      priorOpponents.get(p.teamBId)?.add(p.teamAId);
    }
  }

  const used = new Set<string>();
  const pairings: Pairing[] = [];
  for (let i = 0; i < standings.length; i++) {
    const teamA = standings[i];
    if (used.has(teamA.id)) continue;
    used.add(teamA.id);
    let partner = standings.slice(i + 1).find((c) => !used.has(c.id) && !priorOpponents.get(teamA.id)?.has(c.id));
    if (!partner) partner = standings.slice(i + 1).find((c) => !used.has(c.id));
    if (partner) used.add(partner.id);
    pairings.push({ id: uid(), stage: "preliminary", matchLabel, teamAId: teamA.id, teamBId: partner?.id ?? null, released: false });
  }
  return pairings;
}

// Power-protected (fold) seeding: the best seed faces the worst remaining seed
export function generateFoldPairingsForStage(seeded: Array<Team | null>, stage: KnockoutStage, labels: string[]): Pairing[] {
  const midpoint = Math.ceil(seeded.length / 2);
  const upper = seeded.slice(0, midpoint);
  const lower = seeded.slice(midpoint).reverse();
  return upper.map((team, index) => ({
    id: uid(),
    stage,
    matchLabel: labels[index] || `${stage} ${index + 1}`,
    teamAId: team?.id ?? null,
    teamBId: lower[index]?.id ?? null,
    released: false,
  }));
}

export function preliminarySeedOrder(teams: Team[], config: TournamentConfig, scores: Award[]) {
  const prelimRounds = config.rounds.filter((r) => r.stage === "preliminary");
  return computeStandings(teams, scores, prelimRounds).slice(0, config.qualificationCount || 8);
}

// The teams still in it: everyone during the preliminaries, only the paired teams in a knockout stage
export function teamsForCurrentPairingStage(teams: Team[], pairings: Pairing[]) {
  const current = currentPairings(pairings);
  if (current.length === 0 || current[0].stage === "preliminary") return teams;
  const ids = new Set(current.flatMap((pairing) => [pairing.teamAId, pairing.teamBId]).filter(Boolean));
  return teams.filter((team) => ids.has(team.id));
}

// Championship: the top qualifiers from the preliminaries start the knockouts, best seed against worst
export function generateFirstKnockout(teams: Team[], config: TournamentConfig, scores: Award[]) {
  const top = preliminarySeedOrder(teams, config, scores);
  const stage = firstKnockoutStage(config.qualificationCount || 8);
  return generateFoldPairingsForStage(top, stage, knockoutLabels(stage, Math.ceil(top.length / 2)));
}

// Knockout cup: a random draw. Uneven numbers are filled with byes, which go to the top seeds.
export function generateKnockoutDraw(teams: Team[]) {
  const seeds = shuffle(teams);
  let size = 2;
  while (size < seeds.length) size *= 2;
  const padded: Array<Team | null> = [...seeds, ...Array<null>(size - seeds.length).fill(null)];
  const stage = firstKnockoutStage(seeds.length);
  return generateFoldPairingsForStage(padded, stage, knockoutLabels(stage, size / 2));
}

// Seed order of a knockout cup, read back from its first draw (fold: seed 1 v last seed, seed 2 v second last...)
export function knockoutSeedOrder(teams: Team[], pairings: Pairing[], firstStage: KnockoutStage) {
  const first = pairings.filter((p) => p.stage === firstStage);
  const ids = [...first.map((p) => p.teamAId), ...first.map((p) => p.teamBId).reverse()].filter(Boolean);
  return ids.map((id) => teams.find((team) => team.id === id)).filter((team): team is Team => Boolean(team));
}

// Advances the winners of one knockout stage, keeping their seed order, and re-seeds them fold-style
export function advanceKnockout(fromStage: KnockoutStage, toStage: KnockoutStage, seedOrder: Team[], config: TournamentConfig, scores: Award[], pairings: Pairing[]) {
  const winnerIds = pairings
    .filter((p) => p.stage === fromStage)
    .map((p) => matchWinner(p, config, scores))
    .filter(Boolean);
  const advancing = seedOrder.filter((t) => winnerIds.includes(t.id));
  return generateFoldPairingsForStage(advancing, toStage, knockoutLabels(toStage, Math.ceil(advancing.length / 2)));
}

// The knockout stage a tournament starts at: where its draw began, or where it would begin now
export function knockoutStart(config: TournamentConfig, teams: Team[], pairings: Pairing[]): KnockoutStage {
  const drawn = KNOCKOUT_STAGES.find((stage) => pairings.some((p) => p.stage === stage));
  if (drawn) return drawn;
  return formatOf(config) === "knockout" ? firstKnockoutStage(teams.length) : firstKnockoutStage(config.qualificationCount || 8);
}
