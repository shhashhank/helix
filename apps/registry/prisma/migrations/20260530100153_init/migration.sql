-- CreateTable
CREATE TABLE "agent_definitions" (
    "id" UUID NOT NULL,
    "org_id" UUID,
    "role" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "system_prompt" JSONB NOT NULL,
    "model_policy" JSONB NOT NULL,
    "tools" JSONB NOT NULL,
    "guardrails" JSONB NOT NULL,
    "output_schema" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "agent_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_definitions_org_id_role_deleted_at_idx" ON "agent_definitions"("org_id", "role", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_definitions_org_id_role_version_key" ON "agent_definitions"("org_id", "role", "version");
