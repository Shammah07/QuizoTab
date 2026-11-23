-- The verifier sets search_path to pg_catalog before deparsing definitions.
WITH ns AS (
  SELECT oid,nspname FROM pg_namespace WHERE nspname IN ('public','drizzle','pilot_admission')
), rel AS (
  SELECT c.*,nspname FROM pg_class c JOIN ns ON ns.oid=c.relnamespace
), items(item) AS (
  SELECT jsonb_build_array('object',nspname,pg_describe_object(classid,objid,objsubid))
  FROM pg_depend JOIN ns ON refobjid=ns.oid
  WHERE refclassid='pg_namespace'::regclass AND classid <> 'pg_default_acl'::regclass
  UNION ALL SELECT jsonb_build_array('rel',nspname,relname,relkind,relpersistence,relrowsecurity,relforcerowsecurity,relispartition) FROM rel
  UNION ALL SELECT jsonb_build_array('col',nspname,relname,attnum,attname,format_type(atttypid,atttypmod),attnotnull,
    attidentity,attgenerated,attcollation::regcollation::text,pg_get_expr(adbin,adrelid))
    FROM rel JOIN pg_attribute ON attrelid=rel.oid LEFT JOIN pg_attrdef ON adrelid=attrelid AND adnum=attnum
    WHERE attnum>0 AND NOT attisdropped
  UNION ALL SELECT jsonb_build_array('constraint',conrelid::regclass::text,conname,pg_get_constraintdef(c.oid),
    convalidated,coalesce((to_jsonb(c)->>'conenforced')::boolean,true)) FROM pg_constraint c JOIN ns ON ns.oid=connamespace
    WHERE contype<>'n'
  UNION ALL SELECT jsonb_build_array('index',pg_get_indexdef(indexrelid),indisvalid,indisready,indislive)
    FROM pg_index JOIN rel ON rel.oid=indexrelid
  UNION ALL SELECT jsonb_build_array('enum',nspname,typname,enumlabel,enumsortorder)
    FROM pg_type t JOIN ns ON ns.oid=typnamespace JOIN pg_enum ON enumtypid=t.oid
  UNION ALL SELECT jsonb_build_array('trigger',pg_get_triggerdef(t.oid),tgenabled) FROM pg_trigger t JOIN rel ON rel.oid=tgrelid
    WHERE NOT tgisinternal
  UNION ALL SELECT jsonb_build_array('foreign key enforcement',relname,tgenabled,count(*)) FROM pg_trigger JOIN rel ON rel.oid=tgrelid
    WHERE tgisinternal GROUP BY relname,tgenabled
  UNION ALL SELECT jsonb_build_array('function',pg_get_functiondef(p.oid)) FROM pg_proc p JOIN ns ON ns.oid=pronamespace
  UNION ALL SELECT jsonb_build_array('seq',relname,seqstart,seqincrement,seqmin,seqmax,seqcache,seqcycle)
    FROM pg_sequence JOIN rel ON rel.oid=seqrelid
  UNION ALL SELECT jsonb_build_array('rule',pg_get_ruledef(r.oid)) FROM pg_rewrite r JOIN rel ON rel.oid=ev_class
  UNION ALL SELECT jsonb_build_array('policy',relname,polname) FROM pg_policy JOIN rel ON rel.oid=polrelid
  UNION ALL SELECT jsonb_build_array('event',evtname) FROM pg_event_trigger
)
SELECT item::text AS item FROM items ORDER BY item::text COLLATE "C";
