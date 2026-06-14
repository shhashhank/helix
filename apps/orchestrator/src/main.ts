import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { initTelemetry } from '@helix/telemetry';
import { AppModule } from './app/app.module';

// HELIX-78: the orchestrator's HTTP surface — start / get / cancel / retry workflow
// runs under /api/runs, plus OpenAPI docs at /api/docs. Talks to Temporal as a client.
async function bootstrap() {
  // HELIX-137: service-level OTel — registered globally so any in-process tracer
  // user resolves to this provider. Exporter comes from OTEL_TRACE_EXPORTER
  // (console for dev; OTLP→collector is the deferred binding, see DEFERRED.md).
  const telemetry = initTelemetry({
    serviceName: 'orchestrator',
    environment: process.env.NODE_ENV,
    global: true,
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void telemetry.shutdown());
  }

  const app = await NestFactory.create(AppModule);

  // CORS so the web app (apps/web, dev server on :4200) can call this API cross-origin.
  // Dev: reflect any origin; production: restrict via CORS_ORIGIN (comma-separated allowlist).
  app.enableCors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) : true,
    credentials: true,
  });

  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  const config = new DocumentBuilder()
    .setTitle('Helix Workflow Orchestrator')
    .setDescription('Start, inspect, cancel, and retry durable workflow runs')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${globalPrefix}/docs`, app, document);

  const port = process.env.ORCHESTRATOR_PORT ?? 3100;
  await app.listen(port);
  Logger.log(`Orchestrator listening on http://localhost:${port}/${globalPrefix} (docs at /${globalPrefix}/docs)`);
}

bootstrap();
