-- CreateTable
CREATE TABLE "approval_policies" (
    "id" UUID NOT NULL,
    "org_id" UUID,
    "policy_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "approval_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_policies_org_id_policy_id_deleted_at_idx" ON "approval_policies"("org_id", "policy_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "approval_policies_org_id_policy_id_version_key" ON "approval_policies"("org_id", "policy_id", "version");
