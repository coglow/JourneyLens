-- AlterTable
ALTER TABLE "campaigns"
    ADD COLUMN "goal_event_type" "JourneyEventType",
    ADD COLUMN "goal_same_product" BOOLEAN NOT NULL DEFAULT false;

-- 目标只接受四类行为
ALTER TABLE "campaigns"
    ADD CONSTRAINT "campaigns_goal_event_type_check" CHECK (
        "goal_event_type" IS NULL
        OR "goal_event_type" IN ('purchase_completed', 'reservation_created', 'registration_completed', 'subscription_started')
    );

-- 未配置目标不能开启同商品；只有购买和预约可以要求同一商品
-- CHECK 会放行结果为 NULL 的表达式，因此开启同商品时必须显式要求目标非空。
ALTER TABLE "campaigns"
    ADD CONSTRAINT "campaigns_goal_same_product_check" CHECK (
        NOT "goal_same_product"
        OR (
            "goal_event_type" IS NOT NULL
            AND "goal_event_type" IN ('purchase_completed', 'reservation_created')
        )
    );

-- AlterTable
ALTER TABLE "executions"
    ADD COLUMN "goal_reached_at" TIMESTAMPTZ(6),
    ADD COLUMN "goal_event_id" UUID;

-- AddForeignKey
ALTER TABLE "executions"
    ADD CONSTRAINT "executions_goal_event_id_fkey"
    FOREIGN KEY ("goal_event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 目标时间与目标行为 ID 同空或同有
ALTER TABLE "executions"
    ADD CONSTRAINT "executions_goal_evidence_check" CHECK (
        ("goal_reached_at" IS NULL) = ("goal_event_id" IS NULL)
    );

-- 固定“达成即退出”：有目标事实时执行必须已完成并写入结束时间
ALTER TABLE "executions"
    ADD CONSTRAINT "executions_goal_completed_check" CHECK (
        "goal_reached_at" IS NULL
        OR ("status" = 'completed' AND "ended_at" IS NOT NULL)
    );

-- 活动状态收敛
CREATE TYPE "CampaignStatus_new" AS ENUM ('draft', 'running', 'paused', 'stopped');

ALTER TABLE "campaigns" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "campaigns"
    ALTER COLUMN "status" TYPE "CampaignStatus_new"
    USING ("status"::text::"CampaignStatus_new");
ALTER TABLE "campaigns" ALTER COLUMN "status" SET DEFAULT 'draft';

DROP TYPE "CampaignStatus";
ALTER TYPE "CampaignStatus_new" RENAME TO "CampaignStatus";
