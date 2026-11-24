CREATE SCHEMA staging_control;
REVOKE ALL ON SCHEMA staging_control FROM PUBLIC;
CREATE TABLE staging_control.installation (
  singleton boolean PRIMARY KEY CHECK (singleton),
  session_hash text NOT NULL, guard_hash text NOT NULL
);
CREATE TABLE staging_control.fixtures (
  id uuid PRIMARY KEY, approval text UNIQUE NOT NULL, owner_id integer UNIQUE NOT NULL REFERENCES public.users(id),
  project text NOT NULL, branch text NOT NULL, endpoint text NOT NULL,
  consumed boolean NOT NULL DEFAULT false
);
CREATE FUNCTION staging_control.guard_engine() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.scoring_engine_version IS DISTINCT FROM OLD.scoring_engine_version OR
       (OLD.scoring_engine_version = 'room_v1' AND (NEW.owner_id,NEW.id) IS DISTINCT FROM (OLD.owner_id,OLD.id)) THEN
      RAISE EXCEPTION 'Immutable tournament identity' USING ERRCODE='QT403';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.scoring_engine_version = 'legacy' THEN RETURN NEW; END IF;
  IF NEW.scoring_engine_version = 'room_v1' AND session_user='quizotab_pilot_setup'
     AND current_user='quizotab_pilot_setup' AND current_database()='quizotab_pilot' THEN
    UPDATE staging_control.fixtures SET consumed=true WHERE id=NEW.id AND owner_id=NEW.owner_id AND NOT consumed
      AND project=current_setting('neon.project_id',true) AND branch=current_setting('neon.branch_id',true)
      AND endpoint=current_setting('neon.endpoint_id',true);
    IF FOUND THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Closed staging admission' USING ERRCODE='QT403';
END;
$$;
REVOKE ALL ON FUNCTION staging_control.guard_engine() FROM PUBLIC;
CREATE TRIGGER staging_engine_guard BEFORE INSERT OR UPDATE ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION staging_control.guard_engine();
ALTER TABLE public.tournaments ENABLE ALWAYS TRIGGER staging_engine_guard;
ALTER TABLE public.tournaments DROP CONSTRAINT tournaments_legacy_engine_only;
