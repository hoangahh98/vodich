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
  // CSP: chặn XSS. script-src 'self' (không inline script) — đã bỏ hết inline handler.
  // Bootstrap đã self-host nên không cần mở cho cdn.jsdelivr.net nữa.
  // Bỏ upgrade-insecure-requests để dev/e2e chạy http localhost được.
  app.use(
    helmet.default({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'upgrade-insecure-requests': null,
        },
      },
    }),
  );
  app.use(await getSessionMiddleware());
  // Không đặt maxAge dài: css/js không có hash trong tên nên deploy mới sẽ bị kẹt bản cũ.
  // Việc giữ giao diện khi server ngủ do service worker (public/sw.js) lo, còn ở đây chỉ
  // cần ETag mặc định của express để revalidate rẻ. Riêng sw.js phải luôn tươi, nếu không
  // bản vá service worker sẽ không bao giờ tới được máy người dùng.
  app.useStaticAssets(join(__dirname, '..', 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    },
  });
  app.setBaseViewsDir(join(__dirname, 'views'));
  app.setViewEngine('ejs');
  app.useGlobalFilters(new ViewExceptionFilter());
  // Đóng kết nối Prisma/Redis sạch khi Render gửi SIGTERM lúc deploy/restart.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT || 3000);
}

bootstrap();
