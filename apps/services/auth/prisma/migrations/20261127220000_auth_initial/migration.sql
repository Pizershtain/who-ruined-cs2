-- CreateEnum
CREATE TYPE "AuthUserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "AuthUser" (
    "id" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "AuthUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthPassword" (
    "userId" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,

    CONSTRAINT "AuthPassword_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AuthExternalIdentity" (
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "AuthExternalIdentity_pkey" PRIMARY KEY ("provider","providerUserId")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthRefreshToken" (
    "digest" CHAR(64) NOT NULL,
    "sessionId" UUID NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "AuthRefreshToken_pkey" PRIMARY KEY ("digest")
);

-- CreateTable
CREATE TABLE "AuthLoginLimit" (
    "key" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthLoginLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthPassword_username_key" ON "AuthPassword"("username");

-- CreateIndex
CREATE INDEX "AuthExternalIdentity_userId_idx" ON "AuthExternalIdentity"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthRefreshToken_sessionId_idx" ON "AuthRefreshToken"("sessionId");

-- CreateIndex
CREATE INDEX "AuthLoginLimit_expiresAt_idx" ON "AuthLoginLimit"("expiresAt");

-- AddForeignKey
ALTER TABLE "AuthPassword" ADD CONSTRAINT "AuthPassword_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthExternalIdentity" ADD CONSTRAINT "AuthExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthRefreshToken" ADD CONSTRAINT "AuthRefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuthPassword" ADD CONSTRAINT "auth_username_canonical" CHECK (username COLLATE "C" ~ '^[a-z0-9][a-z0-9_-]{2,31}$');
