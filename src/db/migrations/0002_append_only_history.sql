-- Lead timeline and pipeline history are append-only: rows can be inserted, never changed or
-- removed. (TRUNCATE, used only by the test suite, does not fire row triggers.)
CREATE OR REPLACE FUNCTION forbid_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER lead_events_append_only
  BEFORE UPDATE OR DELETE ON lead_events
  FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
--> statement-breakpoint
CREATE TRIGGER stage_transitions_append_only
  BEFORE UPDATE OR DELETE ON stage_transitions
  FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
