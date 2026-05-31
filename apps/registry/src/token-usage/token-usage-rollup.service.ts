import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Aggregated token + cost totals for a slice of usage. */
export interface CostRollup {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  costUsd: number;
}

/** A {@link CostRollup} for a single calendar day (UTC). */
export interface DailyCostRollup extends CostRollup {
  /** `YYYY-MM-DD` (UTC). */
  day: string;
}

/** Optional inclusive-from / exclusive-to time window over `created_at`. */
export interface TimeRange {
  from?: Date;
  to?: Date;
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));

/**
 * Cost roll-up jobs (HELIX-67): aggregate the per-call rows written by the usage
 * meter (HELIX-57) into spend/token totals by run, by org, and by org-and-day.
 * Feeds billing and cost dashboards.
 */
@Injectable()
export class TokenUsageRollupService {
  constructor(private readonly prisma: PrismaService) {}

  byRun(runId: string): Promise<CostRollup> {
    return this.aggregate({ runId });
  }

  byOrg(orgId: string | null, range: TimeRange = {}): Promise<CostRollup> {
    return this.aggregate({ orgId, createdAt: createdAtFilter(range) });
  }

  private async aggregate(where: Record<string, unknown>): Promise<CostRollup> {
    const r = await this.prisma.tokenUsage.aggregate({
      where,
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheCreationInputTokens: true,
        cacheReadInputTokens: true,
        costUsd: true,
      },
    });
    return toRollup({
      calls: r._count._all,
      inputTokens: r._sum.inputTokens,
      outputTokens: r._sum.outputTokens,
      cacheCreationInputTokens: r._sum.cacheCreationInputTokens,
      cacheReadInputTokens: r._sum.cacheReadInputTokens,
      costUsd: r._sum.costUsd,
    });
  }

  /** Per-day totals for an org (UTC), oldest day first. */
  async byOrgDaily(orgId: string | null, range: TimeRange = {}): Promise<DailyCostRollup[]> {
    const from = range.from ?? null;
    const to = range.to ?? null;
    const rows = await this.prisma.$queryRaw<
      {
        day: Date;
        calls: bigint;
        in_tokens: bigint;
        out_tokens: bigint;
        cc_tokens: bigint;
        cr_tokens: bigint;
        cost_usd: string | null;
      }[]
    >`
      SELECT date_trunc('day', created_at) AS day,
             count(*) AS calls,
             coalesce(sum(input_tokens), 0) AS in_tokens,
             coalesce(sum(output_tokens), 0) AS out_tokens,
             coalesce(sum(cache_creation_input_tokens), 0) AS cc_tokens,
             coalesce(sum(cache_read_input_tokens), 0) AS cr_tokens,
             sum(cost_usd) AS cost_usd
      FROM token_usage
      WHERE (${orgId}::text IS NULL AND org_id IS NULL OR org_id = ${orgId})
        AND (${from}::timestamptz IS NULL OR created_at >= ${from})
        AND (${to}::timestamptz IS NULL OR created_at < ${to})
      GROUP BY day
      ORDER BY day ASC`;

    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      ...toRollup({
        calls: r.calls,
        inputTokens: r.in_tokens,
        outputTokens: r.out_tokens,
        cacheCreationInputTokens: r.cc_tokens,
        cacheReadInputTokens: r.cr_tokens,
        costUsd: r.cost_usd,
      }),
    }));
  }
}

function createdAtFilter(range: TimeRange): Record<string, Date> | undefined {
  const filter: Record<string, Date> = {};
  if (range.from) filter.gte = range.from;
  if (range.to) filter.lt = range.to;
  return Object.keys(filter).length ? filter : undefined;
}

function toRollup(raw: {
  calls: unknown;
  inputTokens: unknown;
  outputTokens: unknown;
  cacheCreationInputTokens: unknown;
  cacheReadInputTokens: unknown;
  costUsd: unknown;
}): CostRollup {
  const inputTokens = num(raw.inputTokens);
  const outputTokens = num(raw.outputTokens);
  const cacheCreationInputTokens = num(raw.cacheCreationInputTokens);
  const cacheReadInputTokens = num(raw.cacheReadInputTokens);
  return {
    calls: num(raw.calls),
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
    costUsd: num(raw.costUsd),
  };
}
