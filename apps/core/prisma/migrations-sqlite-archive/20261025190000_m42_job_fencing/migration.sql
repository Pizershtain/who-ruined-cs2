ALTER TABLE "Job" ADD COLUMN "leaseToken" TEXT;
CREATE INDEX "Job_leaseUntil_idx" ON "Job"("leaseUntil");
