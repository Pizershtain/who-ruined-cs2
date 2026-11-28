ALTER TABLE "ProfileFeedCursor"
  ADD COLUMN "aggregateBackfillAfter" TEXT,
  ADD COLUMN "aggregateBackfillComplete" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "replaying" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ProfileAggregate" (
    "steamId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" BIGINT NOT NULL,
    "summary" JSONB NOT NULL,
    CONSTRAINT "ProfileAggregate_pkey" PRIMARY KEY ("steamId")
);
