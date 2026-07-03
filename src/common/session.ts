import * as session from 'express-session';
import { RedisStore } from 'connect-redis';
import { RequestHandler } from 'express';
import { createConnectedRedisClient, isRedisConfigured, recordRedisLog, redisConnectionSummary } from './redis';

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
        recordRedisLog('INFO', 'session store enabled', redisConnectionSummary());
      }
    } catch (error) {
      recordRedisLog('ERROR', 'session store fallback to memory', redisConnectionSummary(), error);
    }
  } else {
    recordRedisLog('WARN', 'session store using memory', redisConnectionSummary());
  }

  return session(options);
}
