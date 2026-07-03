import { createClient } from 'redis';

export type AppRedisClient = ReturnType<typeof createClient> & {
  connect: () => Promise<unknown>;
  quit: () => Promise<unknown>;
  on: (event: string, listener: (error: unknown) => void) => AppRedisClient;
};

const redisUrl = process.env.REDIS_URL?.trim();

export function isRedisConfigured() {
  return !!redisUrl;
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
    console.error(`[redis:${label}] ${error instanceof Error ? error.message : String(error)}`);
  });
  return client;
}

export async function createConnectedRedisClient(label: string): Promise<AppRedisClient | undefined> {
  const client = createRedisClient(label);
  if (!client) return undefined;
  await client.connect();
  console.log(`[redis:${label}] connected`);
  return client;
}
