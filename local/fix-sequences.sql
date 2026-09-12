-- After a \copy load the rows carry their original ids but every sequence is still at 1,
-- so the first INSERT collides ("duplicate key value violates unique constraint ..._pkey").
-- Move each serial / identity sequence past the largest id actually present.
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, c.relname AS tbl, a.attname AS col,
           pg_get_serial_sequence(quote_ident(n.nspname)||'.'||quote_ident(c.relname), a.attname) AS seq
      FROM pg_class c
      JOIN pg_namespace nn ON nn.oid = c.relnamespace
      JOIN pg_namespace n  ON n.oid  = c.relnamespace
      JOIN pg_attribute a  ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relkind = 'r'
       AND n.nspname NOT IN ('pg_catalog','information_schema')
       AND pg_get_serial_sequence(quote_ident(n.nspname)||'.'||quote_ident(c.relname), a.attname) IS NOT NULL
  LOOP
    EXECUTE format('SELECT COALESCE(max(%I),0) FROM %I.%I', r.col, r.sch, r.tbl) INTO n;
    PERFORM setval(r.seq, n + 1, false);
  END LOOP;
END $$;
