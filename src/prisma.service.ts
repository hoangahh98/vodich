import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ datasources: { db: { url: runtimeDatabaseUrl() } } });
  }

  async onModuleInit() {
    if (process.env.SKIP_PRISMA_CONNECT === 'true') return;
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

function runtimeDatabaseUrl() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return rawUrl;

  const defaultLimit = process.env.NODE_ENV === 'production' ? '3' : '';
  const connectionLimit = process.env.DATABASE_CONNECTION_LIMIT || defaultLimit;
  if (!connectionLimit) return rawUrl;

  try {
    const url = new URL(rawUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return rawUrl;
    if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', connectionLimit);
    if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', process.env.DATABASE_POOL_TIMEOUT || '20');
    return url.toString();
  } catch {
    return rawUrl;
  }
}
