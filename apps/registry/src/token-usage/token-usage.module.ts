import { Module } from '@nestjs/common';
import { PrismaUsageSink } from './prisma-usage.sink';
import { TokenUsageRepository } from './token-usage.repository';
import { TokenUsageRollupService } from './token-usage-rollup.service';

@Module({
  providers: [TokenUsageRepository, PrismaUsageSink, TokenUsageRollupService],
  exports: [TokenUsageRepository, PrismaUsageSink, TokenUsageRollupService],
})
export class TokenUsageModule {}
