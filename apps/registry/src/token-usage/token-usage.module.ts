import { Module } from '@nestjs/common';
import { PrismaUsageSink } from './prisma-usage.sink';
import { TokenUsageRepository } from './token-usage.repository';

@Module({
  providers: [TokenUsageRepository, PrismaUsageSink],
  exports: [TokenUsageRepository, PrismaUsageSink],
})
export class TokenUsageModule {}
