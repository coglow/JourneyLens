-- CreateTable
CREATE TABLE "audience_users" (
    "id" UUID NOT NULL,
    "external_id" VARCHAR(160) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(320),
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audience_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "audience_users_external_id_key" ON "audience_users"("external_id");

-- CreateTable
CREATE TABLE "segments" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "rules" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "segments_revision_positive_check" CHECK ("revision" >= 1),
    CONSTRAINT "segments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "operator_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "segments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "operator_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "segments_name_key" ON "segments"("name");

-- CreateTable
CREATE TABLE "segment_preview_snapshots" (
    "segment_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "matched" INTEGER NOT NULL,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "segment_preview_snapshots_pkey" PRIMARY KEY ("segment_id"),
    CONSTRAINT "segment_preview_snapshots_revision_positive_check" CHECK ("revision" >= 1),
    CONSTRAINT "segment_preview_snapshots_total_non_negative_check" CHECK ("total" >= 0),
    CONSTRAINT "segment_preview_snapshots_matched_non_negative_check" CHECK ("matched" >= 0),
    CONSTRAINT "segment_preview_snapshots_matched_within_total_check" CHECK ("matched" <= "total"),
    CONSTRAINT "segment_preview_snapshots_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
