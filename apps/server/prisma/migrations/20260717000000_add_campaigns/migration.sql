-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'scheduled', 'running', 'ended', 'stopped');

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "budget" DECIMAL(14, 2),
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "campaigns_budget_nonnegative_check" CHECK ("budget" IS NULL OR "budget" >= 0),
    CONSTRAINT "campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "operator_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "campaigns_created_at_id_idx" ON "campaigns"("created_at" DESC, "id" DESC);
