import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  app.useBodyParser('json', { limit: '5mb' });
  app.set('trust proxy', 1);
  configureApp(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API em http://localhost:${port}  ·  webhooks em /webhook/:slug`);
}

void bootstrap();
