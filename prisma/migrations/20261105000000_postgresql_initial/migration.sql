-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "map" TEXT,
    "status" TEXT NOT NULL,
    "quality" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "normalizerVersion" TEXT NOT NULL,
    "normalizedFilePath" TEXT,
    "rawFilePath" TEXT,
    "resultFilePath" TEXT,
    "resultSchemaVersion" TEXT,
    "resultSha256" TEXT,
    "resultPolicyId" TEXT,
    "resultPolicyDigest" TEXT,
    "sourceDeletedAt" TIMESTAMP(3),
    "deletionState" TEXT,
    "deletionRequestedAt" TIMESTAMP(3),
    "winningTeamId" TEXT,
    "losingTeamId" TEXT,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestedScoringVersion" TEXT,
    "requestedConfigHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "jsonFilePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quality" TEXT NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Match_createdAt_idx" ON "Match"("createdAt");

-- CreateIndex
CREATE INDEX "Match_deletionState_idx" ON "Match"("deletionState");

-- CreateIndex
CREATE UNIQUE INDEX "Match_fileSha256_parserVersion_normalizerVersion_key" ON "Match"("fileSha256", "parserVersion", "normalizerVersion");

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_leaseUntil_idx" ON "Job"("leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Report_matchId_scoringVersion_configHash_key" ON "Report"("matchId", "scoringVersion", "configHash");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
