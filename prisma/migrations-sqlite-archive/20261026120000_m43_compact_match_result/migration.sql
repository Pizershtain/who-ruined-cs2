ALTER TABLE "Match" ADD COLUMN "resultFilePath" TEXT;
ALTER TABLE "Match" ADD COLUMN "resultSchemaVersion" TEXT;
ALTER TABLE "Match" ADD COLUMN "resultSha256" TEXT;
ALTER TABLE "Match" ADD COLUMN "resultPolicyId" TEXT;
ALTER TABLE "Match" ADD COLUMN "resultPolicyDigest" TEXT;
ALTER TABLE "Match" ADD COLUMN "sourceDeletedAt" DATETIME;
ALTER TABLE "Match" ADD COLUMN "deletionState" TEXT;
ALTER TABLE "Match" ADD COLUMN "deletionRequestedAt" DATETIME;

CREATE INDEX "Match_deletionState_idx" ON "Match"("deletionState");
