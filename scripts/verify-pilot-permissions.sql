-- Catalog reads only. Run inside an independently identity-verified, read-only
-- pilot transaction as the setup role. Compare effective results before/after.
SELECT current_database(), session_user, current_user, current_setting('server_version_num') AS version,
       current_setting('transaction_read_only') AS read_only;

SELECT r.rolname, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls,
       pg_has_role('quizotab_pilot_app',r.oid,'USAGE') AS inherited,
       pg_has_role('quizotab_pilot_app',r.oid,'MEMBER') AS member
FROM pg_roles r WHERE pg_has_role('quizotab_pilot_app',r.oid,'MEMBER') ORDER BY 1;

SELECT d.datname, pg_get_userbyid(d.datdba) AS owner, d.datacl::text,
       has_database_privilege('quizotab_pilot_app',d.oid,'CONNECT') AS connect,
       has_database_privilege('quizotab_pilot_app',d.oid,'CREATE') AS create_schema,
       has_database_privilege('quizotab_pilot_app',d.oid,'TEMP') AS temp
FROM pg_database d WHERE datname=current_database();

SELECT nspname, pg_get_userbyid(nspowner) AS owner, nspacl::text,
       has_schema_privilege('quizotab_pilot_app',oid,'USAGE') AS use_schema,
       has_schema_privilege('quizotab_pilot_app',oid,'CREATE') AS create_object
FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' ORDER BY 1;

SELECT n.nspname,c.relname,pg_get_userbyid(c.relowner) AS owner,c.relacl::text,c.relrowsecurity,
       ARRAY(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
             WHERE has_table_privilege('quizotab_pilot_app',c.oid,p)) AS effective,
       ARRAY(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
             WHERE has_table_privilege('quizotab_pilot_app',c.oid,p||' WITH GRANT OPTION')) AS grantable
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p','v','m','f') ORDER BY 1,2;

SELECT n.nspname,c.relname,a.attname,a.attacl::text,
       ARRAY(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
             WHERE has_column_privilege('quizotab_pilot_app',c.oid,a.attnum,p)) AS effective,
       ARRAY(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
             WHERE has_column_privilege('quizotab_pilot_app',c.oid,a.attnum,p||' WITH GRANT OPTION')) AS grantable
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
AND a.attacl IS NOT NULL ORDER BY 1,2,3;

SELECT n.nspname,s.relname,a.attidentity,pg_get_userbyid(s.relowner) AS owner,s.relacl::text,
       ARRAY(SELECT p FROM unnest(ARRAY['SELECT','USAGE','UPDATE']) p
             WHERE has_sequence_privilege('quizotab_pilot_app',s.oid,p)) AS effective
FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace
LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=s.oid AND d.refclassid='pg_class'::regclass AND d.deptype IN ('i','a')
LEFT JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
WHERE s.relkind='S' AND n.nspname IN ('public','drizzle') ORDER BY 1,2;

SELECT p.oid::regprocedure::text AS routine,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,
       has_function_privilege('quizotab_pilot_app',p.oid,'EXECUTE') AS executable,
       EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','drizzle') OR (p.prosecdef AND has_schema_privilege('quizotab_pilot_app',n.oid,'USAGE')
  AND has_function_privilege('quizotab_pilot_app',p.oid,'EXECUTE')) ORDER BY 1;

SELECT pg_get_userbyid(defaclrole) AS creator,coalesce(nspname,'(global)') AS scope,defaclobjtype,defaclacl::text
FROM pg_default_acl LEFT JOIN pg_namespace n ON n.oid=defaclnamespace ORDER BY 1,2,3;

SELECT has_parameter_privilege('quizotab_pilot_app','session_replication_role','SET') AS can_bypass_triggers,
       convalidated, pg_get_constraintdef(oid) AS legacy_gate
FROM pg_constraint WHERE conrelid='public.tournaments'::regclass AND conname='tournaments_legacy_engine_only';

SELECT tgenabled,pg_get_triggerdef(oid) AS audit_trigger FROM pg_trigger
WHERE tgrelid='public.tournament_score_events'::regclass AND tgname='tournament_score_events_append_only';

SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id;

-- PG18 also has MAINTAIN. No effective MAINTAIN is expected before or after.
SELECT c.oid::regclass::text AS unexpected_maintain FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND c.relkind='r'
AND has_table_privilege('quizotab_pilot_app',c.oid,'MAINTAIN');

-- Built-ins used by the service SQL, defaults and constraints. Report inaccessible overloads.
SELECT p.oid::regprocedure::text AS missing_builtin FROM pg_proc p
WHERE p.pronamespace='pg_catalog'::regnamespace AND p.proname IN
('current_setting','current_database','now','clock_timestamp','make_interval','gen_random_uuid',
 'trunc','extract','jsonb_typeof','jsonb_build_object','jsonb_array_length','btrim','count','sum','min','max','array_agg')
AND NOT has_function_privilege('quizotab_pilot_app',p.oid,'EXECUTE');

-- Compare effective column rights and DELETE against the full service matrix.
-- Before grants, missing > 0 is expected. After full grants expect zeros.
-- Use the row for the approved profile. Counts are per column, and per table for DELETE.
SELECT profile, count(*) FILTER (WHERE expected AND NOT actual) AS missing,
       count(*) FILTER (WHERE actual AND NOT expected) AS excess
FROM (
 SELECT profile,c.relname,a.attname,p.op,
   CASE WHEN profile='legacy' AND m.tab IN ('tournament_score_events','tournament_score_entries') AND p.op IN ('INSERT','UPDATE') THEN false
        WHEN p.op='DELETE' THEN m.del ELSE p.cols='*' OR a.attname::text=ANY(string_to_array(p.cols,' ')) END AS expected,
   CASE WHEN p.op='DELETE' THEN has_table_privilege('quizotab_pilot_app',c.oid,p.op)
        ELSE has_column_privilege('quizotab_pilot_app',c.oid,a.attnum,p.op) END AS actual
 FROM (VALUES
  ('app_settings','','','',false),
  ('auth_tokens','user_id purpose token_hash expires_at used_at created_at','*','used_at',false),
  ('guest_codes','tournament_id code code_key','*','code code_key created_at',false),
  ('payments','','','',false),
  ('quiz_answers','game_id player_id question_index choice correct points','game_id player_id question_index choice correct points answered_ms','',false),
  ('quiz_games','*','*','version status current_index question_started_at question_ends_at tournament_id tournament_label scores_sent_at',false),
  ('quiz_players','*','*','kicked score streak',false),
  ('quiz_solo_runs','id quiz_id nickname token_hash current_index question_opened_at score correct_count finished_at','*','score correct_count current_index question_opened_at finished_at',false),
  ('quizzes','*','*','title description category category_label is_public questions updated_at plays',true),
  ('rate_limits','*','*','',true),
  ('teams','*','*','name category members',true),
  ('tournament_judges','*','*','',true),
  ('tournament_room_staff','*','*','revoked_at',false),
  ('tournament_score_entries','*','*','status reviewer_user_id reviewed_at reason',false),
  ('tournament_score_events','*','*','',false),
  ('tournament_state','*','*','value updated_at',false),
  ('tournaments','*','*','name start_date end_date',true),
  ('users','id name email password role email_verified_at','*','password email_verified_at',true)
 ) m(tab,sel,ins,upd,del)
 JOIN pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=m.tab
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 CROSS JOIN (VALUES ('legacy'),('full')) profiles(profile)
 CROSS JOIN LATERAL (VALUES ('SELECT',m.sel),('INSERT',m.ins),('UPDATE',m.upd),('DELETE','')) p(op,cols)
 WHERE p.op<>'DELETE' OR a.attnum=1
) checks GROUP BY profile ORDER BY profile;
