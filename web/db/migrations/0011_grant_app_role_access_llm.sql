DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unity_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE llm_master_prompt TO unity_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE llm_user_prompt TO unity_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE llm_user_reference TO unity_app;
  END IF;
END $$;
