import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app/app.module';

// HELIX-53 adds the HTTP surface for the agent registry: REST endpoints under
// /api/agents plus OpenAPI docs at /api/docs.
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  const config = new DocumentBuilder()
    .setTitle('Helix Agent Registry')
    .setDescription('CRUD + versioning API for declarative agent definitions')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${globalPrefix}/docs`, app, document);

  const port = process.env.REGISTRY_PORT ?? 3000;
  await app.listen(port);
  Logger.log(`Registry listening on http://localhost:${port}/${globalPrefix} (docs at /${globalPrefix}/docs)`);
}

bootstrap();
