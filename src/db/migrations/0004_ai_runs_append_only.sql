-- AI run records are an audit trail: rows can be inserted, never changed or removed.
-- (Reuses forbid_history_mutation() from 0002. TRUNCATE, used only by tests, does not fire it.)
CREATE TRIGGER ai_runs_append_only
  BEFORE UPDATE OR DELETE ON ai_runs
  FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
