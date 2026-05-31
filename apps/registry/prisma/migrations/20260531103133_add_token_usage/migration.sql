-- CreateTable
CREATE TABLE "token_usage" (
    "id" UUID NOT NULL,
    "org_id" TEXT,
    "run_id" TEXT,
    "agent_role" TEXT,
    "task_class" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_creation_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6),
    "latency_ms" INTEGER,
    "streamed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "token_usage_org_id_created_at_idx" ON "token_usage"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "token_usage_run_id_idx" ON "token_usage"("run_id");
