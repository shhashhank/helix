import { Injectable } from '@nestjs/common';
// Type-only import — no runtime dependency on the gateway library.
import type { UsageRecord, UsageSink } from '@helix/llm';
import { TokenUsageRepository } from './token-usage.repository';

/**
 * Persists {@link UsageRecord}s emitted by the gateway's `MeteredProvider`
 * (HELIX-57) into the `token_usage` table. Implements the `UsageSink` contract
 * from `@helix/llm` so the meter can write without knowing about Prisma.
 */
@Injectable()
export class PrismaUsageSink implements UsageSink {
  constructor(private readonly repo: TokenUsageRepository) {}

  async record(record: UsageRecord): Promise<void> {
    await this.repo.create({
      orgId: record.context.orgId ?? null,
      runId: record.context.runId ?? null,
      agentRole: record.context.agentRole ?? null,
      taskClass: record.context.taskClass ?? null,
      provider: record.provider,
      model: record.model,
      inputTokens: record.usage.inputTokens,
      outputTokens: record.usage.outputTokens,
      cacheCreationInputTokens: record.usage.cacheCreationInputTokens,
      cacheReadInputTokens: record.usage.cacheReadInputTokens,
      costUsd: record.costUsd ?? null,
      latencyMs: record.latencyMs,
      streamed: record.streamed,
    });
  }
}
