import { Module, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import Redis from 'ioredis';
import { RedisWorkingMemory } from './redis-working-memory';

/** DI token for the shared ioredis client. */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/** Default scratchpad TTL: 24h, so abandoned runs don't linger in Redis. */
const DEFAULT_TTL_SECONDS = 60 * 60 * 24;

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      // Lazy connect: the app boots fine without Redis; it's contacted only when
      // working memory is actually used.
      useFactory: () =>
        new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        }),
    },
    {
      provide: RedisWorkingMemory,
      useFactory: (redis: Redis) =>
        new RedisWorkingMemory(redis, { ttlSeconds: DEFAULT_TTL_SECONDS }),
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [RedisWorkingMemory, REDIS_CLIENT],
})
export class WorkingMemoryModule implements OnModuleDestroy {
  constructor(private readonly moduleRef: ModuleRef) {}

  async onModuleDestroy(): Promise<void> {
    const redis = this.moduleRef.get<Redis>(REDIS_CLIENT, { strict: false });
    if (redis.status !== 'end') redis.disconnect();
  }
}
