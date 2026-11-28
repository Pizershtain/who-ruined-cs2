BEGIN;

CREATE TABLE "MatchPublication" (
  "revision" BIGSERIAL PRIMARY KEY,
  "matchId" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('RESULT_PUBLISHED', 'RESULT_UPDATED', 'MATCH_DELETED'))
);
CREATE INDEX "MatchPublication_matchId_revision_idx" ON "MatchPublication" ("matchId", "revision");

CREATE FUNCTION record_match_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  was_visible boolean := false;
  is_visible boolean := false;
  event_kind text;
  source_id text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    was_visible := OLD."resultFilePath" IS NOT NULL AND OLD."deletionState" IS NULL;
    source_id := OLD."id";
  END IF;
  IF TG_OP <> 'DELETE' THEN
    is_visible := NEW."resultFilePath" IS NOT NULL AND NEW."deletionState" IS NULL;
    source_id := NEW."id";
  END IF;

  IF NOT was_visible AND is_visible THEN
    event_kind := 'RESULT_PUBLISHED';
  ELSIF was_visible AND NOT is_visible THEN
    event_kind := 'MATCH_DELETED';
  ELSIF was_visible AND is_visible
    AND ROW(OLD."resultFilePath", OLD."resultSha256", OLD."resultSchemaVersion", OLD."resultPolicyId",
            OLD."resultPolicyDigest", OLD."evpFilePath", OLD."evpSha256", OLD."evpSchemaVersion",
            OLD."evpPolicyId", OLD."evpBindingDigest")
      IS DISTINCT FROM
        ROW(NEW."resultFilePath", NEW."resultSha256", NEW."resultSchemaVersion", NEW."resultPolicyId",
            NEW."resultPolicyDigest", NEW."evpFilePath", NEW."evpSha256", NEW."evpSchemaVersion",
            NEW."evpPolicyId", NEW."evpBindingDigest") THEN
    event_kind := 'RESULT_UPDATED';
  END IF;

  IF event_kind IS NOT NULL THEN
    -- Allocate only after the lock. A fast commit cannot overtake a lower revision.
    -- Sequence gaps caused by rollbacks are valid.
    PERFORM pg_advisory_xact_lock(74292611270090000::bigint);
    INSERT INTO "MatchPublication" ("matchId", "kind") VALUES (source_id, event_kind);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER match_publication_after_change
AFTER INSERT OR UPDATE OR DELETE ON "Match"
FOR EACH ROW EXECUTE FUNCTION record_match_publication();

-- CREATE TRIGGER already excludes concurrent Match writes until commit.
INSERT INTO "MatchPublication" ("matchId", "kind")
SELECT "id", 'RESULT_PUBLISHED'
FROM "Match"
WHERE "resultFilePath" IS NOT NULL AND "deletionState" IS NULL
ORDER BY "createdAt", "id";

COMMIT;
