import * as session from 'express-session';
import { RedisStore } from 'connect-redis';
import { RequestHandler } from 'express';
import { createConnectedRedisClient, isRedisConfigured } from './redis';

const sessionMaxAge = 12 * 60 * 60 * 1000;
let sessionMiddlewarePromise: Promise<RequestHandler> | undefined;

export function getSessionMiddleware(): Promise<RequestHandler> {
  if (!sessionMiddlewarePromise) sessionMiddlewarePromise = createSessionMiddleware();
  return sessionMiddlewarePromise;
}

async function createSessionMiddleware() {
  const options: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || 'vodich-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: sessionMaxAge },
  };

  if (isRedisConfigured()) {
    try {
      const redisClient = await createConnectedRedisClient('session');
      if (redisClient) {
        options.store = new RedisStore({
          client: redisClient,
          prefix: 'vodich:sess:',
          ttl: Math.floor(sessionMaxAge / 1000),
        });
        console.log('[session] using Redis store');
      }
    } catch (error) {
      console.error(`[session] Redis unavailable, falling back to memory store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return session(options);
}
