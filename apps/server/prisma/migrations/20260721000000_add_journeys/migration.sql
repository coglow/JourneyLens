-- CreateTable
CREATE TABLE "journeys" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "segment_id" UUID,
    "name" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journeys_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "journeys_revision_positive_check" CHECK ("revision" >= 1),
    CONSTRAINT "journeys_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journeys_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journeys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "operator_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journeys_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "operator_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "journeys_campaign_id_name_key" ON "journeys"("campaign_id", "name");

-- CreateIndex
CREATE INDEX "journeys_campaign_id_updated_at_id_idx" ON "journeys"("campaign_id", "updated_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "journeys_segment_id_updated_at_id_idx" ON "journeys"("segment_id", "updated_at" DESC, "id" DESC);
