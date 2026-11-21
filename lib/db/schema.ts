// QuizoTab's whole database on Neon (Postgres).
// It merges the MySQL tables from tools/schema.sql with the tournament tables that lived in Supabase.
// People are linked by users.id everywhere, instead of by email (MySQL) or Supabase user id.

import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ---------- Shapes of the JSON columns ----------

export type QuizMedia = { type: "image" | "video"; src: string };

export type QuizQuestion = {
  text: string;
  answers: string[]; // 2 to 4
  correct: number; // index into answers
  time: number; // seconds
  points: 0 | 1 | 2; // multiplier: no points, standard, double
  media?: QuizMedia;
};

export type GameTeam = { id: string; name: string };

// What the host filled in before paying; the tournament is created from this once Pesapal confirms
export type TournamentDetails = {
  name: string;
  category: string;
  year: number;
  startDate: string;
  endDate: string;
  config: Record<string, unknown>;
};

// ---------- Accounts ----------

export const userRole = pgEnum("user_role", ["host", "judge"]);
export const tokenPurpose = pgEnum("token_purpose", ["verify", "reset"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    // "By default" so ids from the old MySQL users table can be kept when data is moved over
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    name: varchar("name", { length: 255 }).notNull(),
    // Always stored in lower case
    email: varchar("email", { length: 255 }).notNull(),
    // bcrypt hash. Hashes made by PHP's password_hash() work unchanged.
    password: varchar("password", { length: 255 }).notNull(),
    role: userRole("role").notNull().default("host"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

// Email confirmation and password reset links. Only a hash of the token is kept.
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: tokenPurpose("purpose").notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("auth_tokens_hash_unique").on(t.tokenHash), index("auth_tokens_user_purpose").on(t.userId, t.purpose, t.createdAt)],
);

// ---------- Tournaments (were in Supabase) ----------

export const tournamentStatus = pgEnum("tournament_status", ["draft", "active", "archived"]);
export const scoringEngine = pgEnum("scoring_engine", ["legacy", "room_v1"]);
export const roomStaffRole = pgEnum("room_staff_role", ["room_host", "judge"]);
export const scoreStatus = pgEnum("score_status", ["pending", "approved", "rejected", "superseded"]);
export const scoreEventType = pgEnum("score_event_type", ["submitted", "approved", "rejected", "superseded"]);

export const tournaments = pgTable(
  "tournaments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    category: varchar("category", { length: 80 }).notNull().default("custom"),
    year: integer("year").notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: tournamentStatus("status").notNull().default("active"),
    scoringEngineVersion: scoringEngine("scoring_engine_version").notNull().default("legacy"),
    createdAt: createdAt(),
  },
  (t) => [
    index("tournaments_owner").on(t.ownerId, t.status),
    // Lift only after all readers and writers support explicit pilot enrollment.
    check("tournaments_legacy_engine_only", sql`${t.scoringEngineVersion} = 'legacy'`),
  ],
);

// The tournament app keeps its data as named JSON documents: config, scores, pairings, rooms, judges, sharing.
// Same shape as Supabase's tournament_state, so the tournament screens keep their logic.
export const tournamentState = pgTable(
  "tournament_state",
  {
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 40 }).notNull(),
    value: jsonb("value").notNull().default(sql`'[]'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.key] })],
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    category: varchar("category", { length: 80 }),
    // Members' names as the judge typed them
    members: text("members"),
    // Name of the judge who registered the team
    registeredBy: varchar("registered_by", { length: 120 }),
    createdAt: createdAt(),
  },
  (t) => [
    // Two teams in one tournament can't share a name, whatever the capitals. Other tournaments can reuse it.
    uniqueIndex("teams_tournament_name_unique").on(t.tournamentId, sql`lower(${t.name})`),
    uniqueIndex("teams_tournament_id_unique").on(t.tournamentId, t.id),
  ],
);

export const tournamentRoomStaff = pgTable("tournament_room_staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id),
  roomId: text("room_id").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  role: roomStaffRole("role").notNull(),
  createdAt: createdAt(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [
  check("room_staff_room_present", sql`btrim(${t.roomId}) <> ''`),
  check("room_staff_revocation_time", sql`${t.revokedAt} >= ${t.createdAt}`),
  uniqueIndex("room_staff_active_user").on(t.tournamentId, t.roomId, t.userId).where(sql`${t.revokedAt} is null`),
  uniqueIndex("room_staff_active_host").on(t.tournamentId, t.roomId).where(sql`${t.revokedAt} is null and ${t.role} = 'room_host'`),
]);

export const tournamentScoreEntries = pgTable("tournament_score_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id),
  roomId: text("room_id").notNull(),
  // Released fixture or points-format roster. Moving a fixture cannot create a second attempt.
  contextId: text("context_id").notNull(),
  teamId: uuid("team_id").notNull(),
  roundId: text("round_id").notNull(),
  questionKey: text("question_key").notNull(),
  points: integer("points").notNull(),
  status: scoreStatus("status").notNull().default("pending"),
  judgeUserId: integer("judge_user_id").notNull().references(() => users.id),
  reviewerUserId: integer("reviewer_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  clientRequestId: uuid("client_request_id").notNull(),
  revision: integer("revision").notNull().default(1),
  correctionOf: uuid("correction_of"),
  reason: text("reason"),
  createdAt: createdAt(),
}, (t) => {
  const attempt = [t.tournamentId, t.contextId, t.teamId, t.roundId, t.questionKey] as const;
  return [
    foreignKey({ name: "score_team_in_tournament", columns: [t.tournamentId, t.teamId], foreignColumns: [teams.tournamentId, teams.id] }),
    uniqueIndex("score_request_unique").on(t.tournamentId, t.judgeUserId, t.clientRequestId),
    uniqueIndex("score_attempt_revision").on(...attempt, t.revision),
    uniqueIndex("score_attempt_pending").on(...attempt).where(sql`${t.status} = 'pending'`),
    uniqueIndex("score_attempt_approved").on(...attempt).where(sql`${t.status} = 'approved'`),
    uniqueIndex("score_revision_target").on(t.id, t.roomId, ...attempt),
    foreignKey({ name: "score_correction_same_attempt", columns: [t.correctionOf, t.roomId, ...attempt], foreignColumns: [t.id, t.roomId, ...attempt] }),
    index("score_room_status_time").on(t.tournamentId, t.roomId, t.status, t.createdAt),
    check("score_keys_present", sql`btrim(${t.roomId}) <> '' and btrim(${t.contextId}) <> '' and btrim(${t.roundId}) <> '' and btrim(${t.questionKey}) <> ''`),
    check("score_revision_valid", sql`(${t.revision} = 1 and ${t.correctionOf} is null) or
      (${t.revision} > 1 and ${t.correctionOf} is not null and ${t.correctionOf} <> ${t.id} and coalesce(btrim(${t.reason}), '') <> '')`),
    check("score_review_valid", sql`(${t.status} = 'pending' and ${t.reviewerUserId} is null and ${t.reviewedAt} is null) or
      (${t.status} <> 'pending' and ${t.reviewerUserId} is not null and ${t.reviewerUserId} <> ${t.judgeUserId}
       and ${t.reviewedAt} is not null and ${t.reviewedAt} >= ${t.createdAt})`),
    check("score_rejection_reason", sql`${t.status} <> 'rejected' or coalesce(btrim(${t.reason}), '') <> ''`),
  ];
});

export const tournamentScoreEvents = pgTable("tournament_score_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  scoreEntryId: uuid("score_entry_id").notNull().references(() => tournamentScoreEntries.id),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id),
  eventType: scoreEventType("event_type").notNull(),
  details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("score_event_once").on(t.scoreEntryId, t.eventType),
  check("score_event_details_object", sql`jsonb_typeof(${t.details}) = 'object'`),
]);

// Which judge may enter scores for which tournament (was in Supabase app_metadata)
export const tournamentJudges = pgTable(
  "tournament_judges",
  {
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.userId] })],
);

// Guest codes let the audience open a listed tournament. Only the owner ever sees the plain code;
// the public directory compares the keyed fingerprint (HMAC), which can't be reversed.
export const guestCodes = pgTable(
  "guest_codes",
  {
    tournamentId: uuid("tournament_id")
      .primaryKey()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    code: char("code", { length: 6 }).notNull(),
    codeKey: char("code_key", { length: 64 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("guest_codes_key_unique").on(t.codeKey)],
);

// ---------- Payments (Pesapal) ----------

export const paymentStatus = pgEnum("payment_status", ["pending", "completed", "failed", "reversed"]);

// One row per checkout. A tournament is created only once its row is completed.
export const payments = pgTable(
  "payments",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    merchantReference: varchar("merchant_reference", { length: 50 }).notNull(),
    orderTrackingId: varchar("order_tracking_id", { length: 64 }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    tournamentDetails: jsonb("tournament_details").$type<TournamentDetails>().notNull(),
    tournamentId: uuid("tournament_id").references(() => tournaments.id, { onDelete: "set null" }),
    paymentMethod: varchar("payment_method", { length: 60 }),
    confirmationCode: varchar("confirmation_code", { length: 80 }),
    createdAt: createdAt(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("payments_reference_unique").on(t.merchantReference),
    uniqueIndex("payments_tracking_unique").on(t.orderTrackingId),
    index("payments_user_status").on(t.userId, t.status),
  ],
);

// Small server-side values, such as the Pesapal notification id registered for this site
export const appSettings = pgTable("app_settings", {
  name: varchar("name", { length: 80 }).primaryKey(),
  value: varchar("value", { length: 255 }).notNull(),
});

// ---------- Quizzes ----------

export const quizzes = pgTable(
  "quizzes",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 120 }).notNull(),
    description: varchar("description", { length: 200 }),
    // A built-in category id, or "c-" plus a slug for one a host added (its name is in categoryLabel)
    category: varchar("category", { length: 30 }),
    categoryLabel: varchar("category_label", { length: 40 }),
    isPublic: boolean("is_public").notNull().default(false),
    plays: integer("plays").notNull().default(0),
    questions: jsonb("questions").$type<QuizQuestion[]>().notNull(),
    createdAt: createdAt(),
    // Postgres has no "ON UPDATE": the save query sets this itself
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quizzes_owner").on(t.ownerId), index("quizzes_public_category").on(t.isPublic, t.category)],
);

export const gameStatus = pgEnum("game_status", ["lobby", "question", "reveal", "leaderboard", "finished"]);

// One run of a quiz. The questions are copied in when the game starts, so editing the quiz can't change a game in progress.
export const quizGames = pgTable(
  "quiz_games",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    quizId: integer("quiz_id").notNull(),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pin: char("pin", { length: 6 }).notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    questions: jsonb("questions").$type<QuizQuestion[]>().notNull(),
    status: gameStatus("status").notNull().default("lobby"),
    currentIndex: integer("current_index").notNull().default(-1),
    // Millisecond precision. The database is the only clock: screens are told how long is left, never the time itself.
    questionStartedAt: timestamp("question_started_at", { withTimezone: true, precision: 3 }),
    questionEndsAt: timestamp("question_ends_at", { withTimezone: true, precision: 3 }),
    // Goes up on every change, so screens can tell whether they are up to date
    version: integer("version").notNull().default(1),
    // Set when the game counts towards a tournament round
    tournamentId: uuid("tournament_id").references(() => tournaments.id, { onDelete: "set null" }),
    roundId: varchar("round_id", { length: 80 }),
    tournamentLabel: varchar("tournament_label", { length: 200 }),
    teams: jsonb("teams").$type<GameTeam[]>(),
    scoresSentAt: timestamp("scores_sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("quiz_games_pin_status").on(t.pin, t.status), index("quiz_games_owner").on(t.ownerId)],
);

export const quizPlayers = pgTable(
  "quiz_players",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    gameId: integer("game_id")
      .notNull()
      .references(() => quizGames.id, { onDelete: "cascade" }),
    nickname: varchar("nickname", { length: 40 }).notNull(),
    teamId: varchar("team_id", { length: 64 }),
    // SHA-256 of the secret token kept on the player's phone
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    score: integer("score").notNull().default(0),
    streak: integer("streak").notNull().default(0),
    kicked: boolean("kicked").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("quiz_players_game_nickname").on(t.gameId, t.nickname), uniqueIndex("quiz_players_token").on(t.tokenHash)],
);

export const quizAnswers = pgTable(
  "quiz_answers",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    gameId: integer("game_id")
      .notNull()
      .references(() => quizGames.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => quizPlayers.id, { onDelete: "cascade" }),
    questionIndex: integer("question_index").notNull(),
    choice: smallint("choice").notNull(),
    correct: boolean("correct").notNull(),
    points: integer("points").notNull(),
    answeredMs: integer("answered_ms").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // One answer per player per question: a second try is refused by the database itself
    uniqueIndex("quiz_answers_one_answer").on(t.playerId, t.questionIndex),
    index("quiz_answers_game_question").on(t.gameId, t.questionIndex),
  ],
);

// One person playing a public quiz on their own. The server keeps the clock and the score.
export const quizSoloRuns = pgTable(
  "quiz_solo_runs",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    quizId: integer("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    nickname: varchar("nickname", { length: 40 }).notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    currentIndex: integer("current_index").notNull().default(0),
    questionOpenedAt: timestamp("question_opened_at", { withTimezone: true, precision: 3 }),
    score: integer("score").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("quiz_solo_runs_token").on(t.tokenHash), index("quiz_solo_runs_board").on(t.quizId, t.finishedAt, t.score)],
);

// ---------- Rate limits ----------

// Counts attempts per visitor (wrong PINs, wrong guest codes, uploads, emails).
// The PHP site kept these in temp files, which don't survive on Vercel.
export const rateLimits = pgTable(
  "rate_limits",
  {
    // What is being limited and for whom, e.g. "pin:203.0.113.7"
    key: text("key").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rate_limits_key_at").on(t.key, t.at)],
);
