CREATE TABLE "ProfileFeedCursor" ("id" INTEGER PRIMARY KEY CHECK ("id" = 1), "revision" BIGINT NOT NULL);
INSERT INTO "ProfileFeedCursor" ("id", "revision") VALUES (1, 0);

CREATE TABLE "ProfilePendingMatch" (
  "matchId" TEXT PRIMARY KEY, "revision" BIGINT NOT NULL,
  "retryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "attempts" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX "ProfilePendingMatch_retryAt_revision_idx" ON "ProfilePendingMatch" ("retryAt", "revision");

CREATE TABLE "ProfileMatch" (
  "matchId" TEXT PRIMARY KEY, "revision" BIGINT NOT NULL, "fileSha256" TEXT,
  "uploadedAt" TIMESTAMP(3), "playedAt" TIMESTAMP(3), "map" TEXT, "quality" TEXT, "policy" JSONB
);

CREATE TABLE "ProfileParticipation" (
  "steamId" TEXT NOT NULL, "matchId" TEXT NOT NULL, "player" JSONB NOT NULL,
  PRIMARY KEY ("steamId", "matchId"),
  CONSTRAINT "ProfileParticipation_matchId_fkey" FOREIGN KEY ("matchId")
    REFERENCES "ProfileMatch" ("matchId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProfileParticipation_matchId_idx" ON "ProfileParticipation" ("matchId");
