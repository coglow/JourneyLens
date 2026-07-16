
CREATE TYPE "AccountStatus" AS ENUM ('active', 'disabled');

CREATE TABLE "operator_accounts" (
    "id" UUID NOT NULL,
    -- 邮箱大小写不敏感（'Demo@Example.com' 与 'demo@example.com' 是同一个信箱），
    -- 但 Postgres 的字符串比较区分大小写，所以存两列：email 保留原样供展示，
    -- email_normalized 存小写值，唯一索引与登录查询都基于它。
    "email" VARCHAR(320) NOT NULL,
    "email_normalized" VARCHAR(320) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operator_accounts_email_normalized_key" ON "operator_accounts"("email_normalized");

