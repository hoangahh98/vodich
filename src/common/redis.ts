import { createClient } from 'redis';

export type RedisLogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface RedisLogEntry {
  level: RedisLogLevel;
  action: string;
  details?: string;
  errorMessage?: string;
}

export type AppRedisClient = ReturnType<typeof createClient> & {
  connect: () => Promise<unknown>;
  quit: () => Promise<unknown>;
  on: (event: string, listener: (error: unknown) => void) => AppRedisClient;
};

const redisUrl = process.env.REDIS_URL?.trim();
const redisRequired = process.env.REQUIRE_REDIS?.trim().toLowerCase() === 'true';
let redisLogSink: ((entry: RedisLogEntry) => void | Promise<void>) | undefined;

export function setRedisLogSink(sink: (entry: RedisLogEntry) => void | Promise<void>) {
  redisLogSink = sink;
}

export function isRedisConfigured() {
  return !!redisUrl;
}

export function isRedisRequired() {
  return redisRequired;
}

export function redisConnectionSummary() {
  if (!redisUrl) return 'REDIS_URL not configured';
  try {
    const url = new URL(redisUrl);
    return `${url.protocol}//${url.hostname}:${url.port || defaultPort(url.protocol)}`;
  } catch {
    return 'REDIS_URL configured but invalid URL format';
  }
}

export function createRedisClient(label: string): AppRedisClient | undefined {
  if (!redisUrl) return undefined;
  const client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
    },
  }) as AppRedisClient;
  client.on('error', (error) => {
    recordRedisLog('ERROR', `${label} error`, redisConnectionSummary(), error);
  });
  return client;
}

export async function createConnectedRedisClient(label: string): Promise<AppRedisClient | undefined> {
  const client = createRedisClient(label);
  if (!client) return undefined;
  await client.connect();
  recordRedisLog('INFO', `${label} connected`, redisConnectionSummary());
  return client;
}

export function recordRedisLog(level: RedisLogLevel, action: string, details?: string, error?: unknown) {
  const errorMessage = redisErrorMessage(error);
  const line = `[redis] ${level} ${action}${details ? ` (${details})` : ''}${errorMessage ? ` - ${errorMessage}` : ''}`;
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
  redisLogSink?.({ level, action, details, errorMessage })?.catch?.(() => undefined);
}

export function requiredRedisError(action: string, error?: unknown) {
  const details = redisErrorMessage(error);
  const message = `REQUIRE_REDIS=true but ${action}${details ? `: ${details}` : ''}`;
  const wrapped = new Error(message);
  (wrapped as Error & { cause?: unknown }).cause = error;
  return wrapped;
}

function redisErrorMessage(error?: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : error ? String(error) : undefined;
}

function defaultPort(protocol: string) {
  return protocol === 'rediss:' ? '6380' : '6379';
}
