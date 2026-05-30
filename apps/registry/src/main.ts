import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

// HELIX-51 ships persistence + service only — HTTP controllers land with HELIX-53.
// Bootstrap as a standalone application so the module graph initializes
// (Prisma onModuleInit etc.) without binding an HTTP port.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  Logger.log('Registry application context initialized (no HTTP listener — HELIX-53 will add controllers).');
  await app.close();
}

bootstrap();
