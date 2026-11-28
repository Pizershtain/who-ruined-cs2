ALTER TABLE "Match"
ADD COLUMN "evpFilePath" TEXT,
ADD COLUMN "evpSchemaVersion" TEXT,
ADD COLUMN "evpSha256" TEXT,
ADD COLUMN "evpPolicyId" TEXT,
ADD COLUMN "evpBindingDigest" TEXT;
