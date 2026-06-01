import { Module } from '@nestjs/common';
import { Client, Connection } from '@temporalio/client';
import { TEMPORAL_CLIENT } from './temporal.constants';

/**
 * Provides a single Temporal {@link Client} (connection to the Temporal server)
 * for the app to dispatch and inspect runs. Address/namespace come from env
 * (`TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`); in tests this provider is overridden
 * with a mock client so no server is needed.
 */
@Module({
  providers: [
    {
      provide: TEMPORAL_CLIENT,
      useFactory: async (): Promise<Client> => {
        const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
        const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
        const connection = await Connection.connect({ address });
        return new Client({ connection, namespace });
      },
    },
  ],
  exports: [TEMPORAL_CLIENT],
})
export class TemporalModule {}
