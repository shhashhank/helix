-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "memory_embeddings" (
    "id" UUID NOT NULL,
    "org_id" TEXT,
    "namespace" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "embedding" vector(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memory_embeddings_org_id_namespace_idx" ON "memory_embeddings"("org_id", "namespace");
