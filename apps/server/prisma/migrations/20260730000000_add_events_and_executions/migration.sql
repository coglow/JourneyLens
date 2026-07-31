-- CreateEnum
CREATE TYPE "JourneyEventType" AS ENUM ('product_viewed', 'purchase_completed', 'reservation_created', 'app_session_started', 'app_exit', 'registration_completed', 'subscription_started');

-- CreateEnum
CREATE TYPE "JourneyNodeType" AS ENUM ('start', 'condition', 'wait', 'wait_for_event', 'message', 'end');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('running', 'waiting', 'completed', 'failed', 'stopped');

-- CreateEnum
CREATE TYPE "ExecutionStepStatus" AS ENUM ('waiting', 'succeeded', 'failed', 'stopped');

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "audience_user_id" UUID NOT NULL,
    "type" "JourneyEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "audience_snapshot" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "events_audience_user_id_fkey" FOREIGN KEY ("audience_user_id") REFERENCES "audience_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "executions" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "journey_version_id" UUID NOT NULL,
    "audience_user_id" UUID NOT NULL,
    "trigger_event_id" UUID NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'running',
    "current_node_id" VARCHAR(64),
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "executions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "executions_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "executions_journey_version_id_fkey" FOREIGN KEY ("journey_version_id") REFERENCES "journey_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "executions_audience_user_id_fkey" FOREIGN KEY ("audience_user_id") REFERENCES "audience_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "executions_trigger_event_id_fkey" FOREIGN KEY ("trigger_event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "execution_steps" (
    "id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "node_id" VARCHAR(64) NOT NULL,
    "node_type" "JourneyNodeType" NOT NULL,
    "status" "ExecutionStepStatus" NOT NULL,
    "output" JSONB NOT NULL,
    "failure_reason" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "deadline_at" TIMESTAMPTZ(6),
    "matched_event_id" UUID,

    CONSTRAINT "execution_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "execution_steps_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "execution_steps_matched_event_id_fkey" FOREIGN KEY ("matched_event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "events_audience_user_id_type_received_at_id_idx" ON "events"("audience_user_id", "type", "received_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "executions_journey_id_trigger_event_id_key" ON "executions"("journey_id", "trigger_event_id");

-- CreateIndex
CREATE INDEX "executions_status_created_at_id_idx" ON "executions"("status", "created_at", "id");

-- CreateIndex
CREATE INDEX "executions_campaign_id_created_at_id_idx" ON "executions"("campaign_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "executions_journey_id_created_at_id_idx" ON "executions"("journey_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "executions_audience_user_id_created_at_id_idx" ON "executions"("audience_user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "executions_created_at_id_idx" ON "executions"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "executions_ended_at_idx" ON "executions"("ended_at");

-- CreateIndex
CREATE UNIQUE INDEX "execution_steps_execution_id_node_id_key" ON "execution_steps"("execution_id", "node_id");

-- CreateIndex
CREATE UNIQUE INDEX "execution_steps_execution_id_order_key" ON "execution_steps"("execution_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "execution_steps_execution_id_matched_event_id_key" ON "execution_steps"("execution_id", "matched_event_id");
