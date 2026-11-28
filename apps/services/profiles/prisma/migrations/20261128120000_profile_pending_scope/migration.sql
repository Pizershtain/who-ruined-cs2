ALTER TABLE "ProfilePendingMatch" ADD COLUMN "affectedSteamIds" JSONB
  CHECK ("affectedSteamIds" IS NULL OR jsonb_typeof("affectedSteamIds") = 'array');

CREATE INDEX "ProfilePendingMatch_affectedSteamIds_idx" ON "ProfilePendingMatch" USING GIN ("affectedSteamIds");
CREATE INDEX "ProfilePendingMatch_unknown_scope_idx" ON "ProfilePendingMatch" ("matchId") WHERE "affectedSteamIds" IS NULL;
