-- Baseline for new databases. Later M4 migrations add lease fencing and the
-- compact match-result lifecycle columns.
CREATE TABLE "Match" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "originalFileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "map" TEXT,
    "status" TEXT NOT NULL,
    "quality" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "normalizerVersion" TEXT NOT NULL,
    "normalizedFilePath" TEXT,
    "rawFilePath" TEXT,
    "winningTeamId" TEXT,
    "losingTeamId" TEXT
);

CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestedScoringVersion" TEXT,
    "requestedConfigHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "jsonFilePath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quality" TEXT NOT NULL,
    CONSTRAINT "Report_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Match_fileSha256_parserVersion_normalizerVersion_key" ON "Match"("fileSha256", "parserVersion", "normalizerVersion");
CREATE INDEX "Match_createdAt_idx" ON "Match"("createdAt");
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");
CREATE UNIQUE INDEX "Report_matchId_scoringVersion_configHash_key" ON "Report"("matchId", "scoringVersion", "configHash");
