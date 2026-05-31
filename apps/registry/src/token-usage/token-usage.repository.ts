import { Injectable } from '@nestjs/common';
import { Prisma, TokenUsage } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TokenUsageRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.TokenUsageUncheckedCreateInput): Promise<TokenUsage> {
    return this.prisma.tokenUsage.create({ data });
  }

  /** All usage rows for a run, oldest first. */
  findByRun(runId: string): Promise<TokenUsage[]> {
    return this.prisma.tokenUsage.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
