CREATE TYPE "AuthPlayerLinkSource" AS ENUM ('MANUAL');
CREATE TYPE "AuthPlayerLinkVerification" AS ENUM ('UNVERIFIED');

CREATE TABLE "AuthPlayerLink" (
    "userId" UUID NOT NULL,
    "steamId" VARCHAR(17) NOT NULL,
    "nickname" VARCHAR(80) NOT NULL,
    "source" "AuthPlayerLinkSource" NOT NULL DEFAULT 'MANUAL',
    "verificationStatus" "AuthPlayerLinkVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuthPlayerLink_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "AuthPlayerLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
