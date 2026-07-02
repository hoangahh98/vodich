import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    await this.$executeRawUnsafe('ALTER TABLE "tournament" ADD COLUMN IF NOT EXISTS "end_time" TIMESTAMP(3)');
    await this.$executeRawUnsafe(`
      ALTER TABLE "tournament"
        ALTER COLUMN "prize_rate_1" TYPE DECIMAL(14, 2),
        ALTER COLUMN "prize_rate_2" TYPE DECIMAL(14, 2),
        ALTER COLUMN "prize_rate_3" TYPE DECIMAL(14, 2)
    `);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
