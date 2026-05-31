import { Module } from '@nestjs/common';
import { PgVectorStore } from './pg-vector-store';

@Module({
  providers: [PgVectorStore],
  exports: [PgVectorStore],
})
export class VectorStoreModule {}
