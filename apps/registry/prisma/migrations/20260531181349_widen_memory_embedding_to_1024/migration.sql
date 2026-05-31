-- Widen the memory embedding vector from 64 → 1024 dims (VoyageEmbedder, voyage-3.5).
-- pgvector cannot cast vectors across dimensions, so existing rows are cleared first.
TRUNCATE TABLE "memory_embeddings";

ALTER TABLE "memory_embeddings" ALTER COLUMN "embedding" TYPE vector(1024);
