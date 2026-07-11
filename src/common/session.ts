import * as session from 'express-session';
import { RedisStore } from 'connect-redis';
import { RequestHandler } from 'express';
import { createConnectedRedisClient, isRedisConfigured, isRedisRequired, recordRedisLog, redisConnectionSummary, requiredRedisError, setRedisFeatureStatus } from './redis';

const sessionMaxAge = 12 * 60 * 60 * 1000;
const WEAK_SECRETS = new Set(['', 'change-me', 'vodich-session-secret']);
let sessionMiddlewarePromise: Promise<RequestHandler> | undefined;

export function getSessionMiddleware(): Promise<RequestHandler> {
  if (!sessionMiddlewarePromise) sessionMiddlewarePromise = createSessionMiddleware();
  return sessionMiddlewarePromise;
}

function resolveSessionSecret(): string {
  const secret = (process.env.SESSION_SECRET || '').trim();
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && WEAK_SECRETS.has(secret)) {
    throw new Error(
      'SESSION_SECRET chưa được đặt hoặc còn để giá trị mặc định. Hãy đặt một chuỗi ngẫu nhiên dài (>=32 ký tự) trong biến môi trường trước khi chạy production.',
    );
  }
  return secret || 'vodich-session-secret';
}

async function createSessionMiddleware() {
  const isProduction = process.env.NODE_ENV === 'production';
  const options: session.SessionOptions = {
    secret: resolveSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: sessionMaxAge,
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
    },
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
        setRedisFeatureStatus('sessionStore', true);
      }
    } catch (error) {
      const action = isRedisRequired() ? 'session store failed' : 'session store fallback to memory';
      recordRedisLog('ERROR', action, redisConnectionSummary(), error);
      setRedisFeatureStatus('sessionStore', false, action);
      if (isRedisRequired()) throw requiredRedisError('session store failed', error);
    }
  } else {
    recordRedisLog('WARN', 'session store using memory', redisConnectionSummary());
    setRedisFeatureStatus('sessionStore', false, 'REDIS_URL not configured');
    if (isRedisRequired()) throw requiredRedisError('REDIS_URL is not configured');
  }

  return session(options);
}
