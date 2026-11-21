CREATE TYPE "public"."room_staff_role" AS ENUM('room_host', 'judge');--> statement-breakpoint
CREATE TYPE "public"."score_event_type" AS ENUM('submitted', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."score_status" AS ENUM('pending', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."scoring_engine" AS ENUM('legacy', 'room_v1');--> statement-breakpoint
CREATE TABLE "tournament_room_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"role" "room_staff_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "room_staff_room_present" CHECK (btrim("tournament_room_staff"."room_id") <> ''),
	CONSTRAINT "room_staff_revocation_time" CHECK ("tournament_room_staff"."revoked_at" >= "tournament_room_staff"."created_at")
);
--> statement-breakpoint
CREATE TABLE "tournament_score_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"context_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"round_id" text NOT NULL,
	"question_key" text NOT NULL,
	"points" integer NOT NULL,
	"status" "score_status" DEFAULT 'pending' NOT NULL,
	"judge_user_id" integer NOT NULL,
	"reviewer_user_id" integer,
	"reviewed_at" timestamp with time zone,
	"client_request_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"correction_of" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_keys_present" CHECK (btrim("tournament_score_entries"."room_id") <> '' and btrim("tournament_score_entries"."context_id") <> '' and btrim("tournament_score_entries"."round_id") <> '' and btrim("tournament_score_entries"."question_key") <> ''),
	CONSTRAINT "score_revision_valid" CHECK (("tournament_score_entries"."revision" = 1 and "tournament_score_entries"."correction_of" is null) or
      ("tournament_score_entries"."revision" > 1 and "tournament_score_entries"."correction_of" is not null and "tournament_score_entries"."correction_of" <> "tournament_score_entries"."id" and coalesce(btrim("tournament_score_entries"."reason"), '') <> '')),
	CONSTRAINT "score_review_valid" CHECK (("tournament_score_entries"."status" = 'pending' and "tournament_score_entries"."reviewer_user_id" is null and "tournament_score_entries"."reviewed_at" is null) or
      ("tournament_score_entries"."status" <> 'pending' and "tournament_score_entries"."reviewer_user_id" is not null and "tournament_score_entries"."reviewer_user_id" <> "tournament_score_entries"."judge_user_id"
       and "tournament_score_entries"."reviewed_at" is not null and "tournament_score_entries"."reviewed_at" >= "tournament_score_entries"."created_at")),
	CONSTRAINT "score_rejection_reason" CHECK ("tournament_score_entries"."status" <> 'rejected' or coalesce(btrim("tournament_score_entries"."reason"), '') <> '')
);
--> statement-breakpoint
CREATE TABLE "tournament_score_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"score_entry_id" uuid NOT NULL,
	"actor_user_id" integer NOT NULL,
	"event_type" "score_event_type" NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_event_details_object" CHECK (jsonb_typeof("tournament_score_events"."details") = 'object')
);
--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "scoring_engine_version" "scoring_engine" DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "score_revision_target" ON "tournament_score_entries" USING btree ("id","room_id","tournament_id","context_id","team_id","round_id","question_key");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_tournament_id_unique" ON "teams" USING btree ("tournament_id","id");--> statement-breakpoint
ALTER TABLE "tournament_room_staff" ADD CONSTRAINT "tournament_room_staff_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_room_staff" ADD CONSTRAINT "tournament_room_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_score_entries" ADD CONSTRAINT "tournament_score_entries_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_score_entries" ADD CONSTRAINT "tournament_score_entries_judge_user_id_users_id_fk" FOREIGN KEY ("judge_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_score_entries" ADD CONSTRAINT "tournament_score_entries_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_score_entries" ADD CONSTRAINT "score_team_in_tournament" FOREIGN KEY ("tournament_id","team_id") REFERENCES "public"."teams"("tournament_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_score_entries" ADD CONSTRAINT "score_correction_same_attempt" FOREIGN KEY ("correction_of","room_id","tournament_id","context_id","team_id","round_id","question_key") REFERENCES "public"."tournament_score_entries"("id","room_id","tournament_id","context_id","team_id","round_id","question_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_score_events" ADD CONSTRAINT "tournament_score_events_score_entry_id_tournament_score_entries_id_fk" FOREIGN KEY ("score_entry_id") REFERENCES "public"."tournament_score_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_score_events" ADD CONSTRAINT "tournament_score_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "room_staff_active_user" ON "tournament_room_staff" USING btree ("tournament_id","room_id","user_id") WHERE "tournament_room_staff"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "room_staff_active_host" ON "tournament_room_staff" USING btree ("tournament_id","room_id") WHERE "tournament_room_staff"."revoked_at" is null and "tournament_room_staff"."role" = 'room_host';--> statement-breakpoint
CREATE UNIQUE INDEX "score_request_unique" ON "tournament_score_entries" USING btree ("tournament_id","judge_user_id","client_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "score_attempt_revision" ON "tournament_score_entries" USING btree ("tournament_id","context_id","team_id","round_id","question_key","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "score_attempt_pending" ON "tournament_score_entries" USING btree ("tournament_id","context_id","team_id","round_id","question_key") WHERE "tournament_score_entries"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "score_attempt_approved" ON "tournament_score_entries" USING btree ("tournament_id","context_id","team_id","round_id","question_key") WHERE "tournament_score_entries"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "score_room_status_time" ON "tournament_score_entries" USING btree ("tournament_id","room_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "score_event_once" ON "tournament_score_events" USING btree ("score_entry_id","event_type");--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_legacy_engine_only" CHECK ("tournaments"."scoring_engine_version" = 'legacy');--> statement-breakpoint
-- Audit events are append-only, including for direct SQL and bulk operations.
CREATE FUNCTION prevent_tournament_score_event_changes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tournament score events are append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tournament_score_events_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON tournament_score_events
FOR EACH STATEMENT EXECUTE FUNCTION prevent_tournament_score_event_changes();
