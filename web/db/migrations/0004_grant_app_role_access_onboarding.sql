DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unity_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organization TO unity_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_identity TO unity_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organization_membership TO unity_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE baa_acceptance TO unity_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE org_subscription TO unity_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE onboarding_state TO unity_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE enterprise_contact_request TO unity_app;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO unity_app;
  END IF;
END
$$;
