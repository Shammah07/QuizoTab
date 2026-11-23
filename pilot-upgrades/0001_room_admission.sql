CREATE SCHEMA pilot_admission;
--> statement-breakpoint
CREATE TABLE pilot_admission.policy (
  singleton boolean PRIMARY KEY CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false
);
--> statement-breakpoint
INSERT INTO pilot_admission.policy (singleton) VALUES (true);
--> statement-breakpoint
CREATE TABLE pilot_admission.hosts (
  user_id integer PRIMARY KEY REFERENCES public.users(id)
);
--> statement-breakpoint
CREATE TABLE pilot_admission.upgrades (
  version text PRIMARY KEY,
  sha256 text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE FUNCTION pilot_admission.guard_engine() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.scoring_engine_version IS DISTINCT FROM OLD.scoring_engine_version OR
       (OLD.scoring_engine_version = 'room_v1' AND NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN
      RAISE EXCEPTION 'Tournament engine and room tournament owner are immutable' USING ERRCODE = 'QT403';
    END IF;
    RETURN NULL;
  END IF;
  IF NEW.scoring_engine_version = 'legacy' THEN RETURN NULL; END IF;
  IF NEW.scoring_engine_version IS DISTINCT FROM 'room_v1' OR
     current_database() <> 'quizotab_pilot' OR session_user <> 'quizotab_pilot_app' OR
     current_setting('neon.project_id',true) IS DISTINCT FROM 'noisy-violet-99522280' OR
     current_setting('neon.branch_id',true) IS DISTINCT FROM 'br-restless-king-bdli89ow' OR
     current_setting('neon.endpoint_id',true) IS DISTINCT FROM 'ep-long-fog-bdc5rxjn' THEN
    RAISE EXCEPTION 'Pilot admission denied' USING ERRCODE = 'QT403';
  END IF;
  -- Shared locks survive until commit. Closing the policy or revoking a host
  -- waits for a creation that already passed these checks, and vice versa.
  PERFORM 1 FROM pilot_admission.policy WHERE singleton AND enabled FOR SHARE;
  IF FOUND THEN
    PERFORM 1 FROM pilot_admission.hosts h JOIN public.users u ON u.id = h.user_id
      WHERE h.user_id = NEW.owner_id AND u.role = 'host' FOR SHARE OF h,u;
    IF FOUND THEN RETURN NULL; END IF;
  END IF;
  RAISE EXCEPTION 'Pilot admission denied' USING ERRCODE = 'QT403';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION pilot_admission.guard_engine() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER pilot_engine_guard_v1 AFTER INSERT OR UPDATE ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION pilot_admission.guard_engine();
--> statement-breakpoint
ALTER TABLE public.tournaments ENABLE ALWAYS TRIGGER pilot_engine_guard_v1;
--> statement-breakpoint
ALTER TABLE public.tournaments DROP CONSTRAINT tournaments_legacy_engine_only;
