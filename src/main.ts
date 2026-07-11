import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as helmet from 'helmet';
import { json, urlencoded } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { ViewExceptionFilter } from './common/view-exception.filter';
import { setRedisLogSink } from './common/redis';
import { getSessionMiddleware } from './common/session';
import { PrismaService } from './prisma.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // Tự cấu hình body parser với giới hạn lớn hơn để nhận ảnh đơn thuốc (base64) ở module y tế.
  app.use(json({ limit: '12mb' }));
  app.use(urlencoded({ extended: true, limit: '12mb' }));
  // Render/Supabase chạy sau reverse proxy: cần trust proxy để cookie `secure`
  // hoạt động và để req.ip lấy đúng IP client (không tin header thô).
  app.set('trust proxy', 1);
  const prisma = app.get(PrismaService);
  if (process.env.DISABLE_APP_LOGS !== 'true') {
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
  }
  app.use(
    helmet.default({
      contentSecurityPolicy: false,
    }),
  );
  app.use(await getSessionMiddleware());
  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setBaseViewsDir(join(__dirname, 'views'));
  app.setViewEngine('ejs');
  app.useGlobalFilters(new ViewExceptionFilter());
  await app.listen(process.env.PORT || 3000);
}

bootstrap();
