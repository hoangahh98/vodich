import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';
import { setRedisLogSink } from './common/redis';
import { getSessionMiddleware } from './common/session';
import { PrismaService } from './prisma.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const prisma = app.get(PrismaService);
  setRedisLogSink(async (entry) => {
    await prisma.appLog.create({
      data: {
        level: entry.level,
        category: 'REDIS',
        action: entry.action.slice(0, 255),
        details: entry.details?.slice(0, 2000),
        errorMessage: entry.errorMessage?.slice(0, 2000),
      },
    });
  });
  app.use(
    helmet.default({
      contentSecurityPolicy: false,
    }),
  );
  app.use(await getSessionMiddleware());
  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setBaseViewsDir(join(__dirname, 'views'));
  app.setViewEngine('ejs');
  await app.listen(process.env.PORT || 3000);
}

bootstrap();
