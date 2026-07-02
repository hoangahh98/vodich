import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as session from 'express-session';
import * as helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(
    helmet.default({
      contentSecurityPolicy: false,
    }),
  );
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'vodich-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 12 * 60 * 60 * 1000 },
    }),
  );
  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setBaseViewsDir(join(__dirname, 'views'));
  app.setViewEngine('ejs');
  await app.listen(process.env.PORT || 3000);
}

bootstrap();
