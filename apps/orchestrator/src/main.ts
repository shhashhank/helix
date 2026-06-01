import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app/app.module';

// HELIX-78: the orchestrator's HTTP surface — start / get / cancel / retry workflow
// runs under /api/runs, plus OpenAPI docs at /api/docs. Talks to Temporal as a client.
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
