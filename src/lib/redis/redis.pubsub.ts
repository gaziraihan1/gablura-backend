import { Redis } from "ioredis";

function createClient(name: string): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL env variable is required for pub/sub");

  const client = new Redis(url, {
    retryStrategy: (times) => Math.min(times * 200, 10_000),
    keepAlive: 10_000,
    connectionName: name,
    autoResubscribe: true,
    lazyConnect: false,
    enableReadyCheck: true,
  });

  client.on("error", (err) =>
    console.error(`[Redis pubsub:${name}] error`, err.message),
  );
  client.on("connect", () =>
    console.info(`[Redis pubsub:${name}] connected`),
  );
  client.on("reconnecting", () =>
    console.info(`[Redis pubsub:${name}] reconnecting…`),
  );

  return client;
}

let _publisher: Redis | null = null;
let _subscriber: Redis | null = null;

export function getPublisher(): Redis {
  if (!_publisher) _publisher = createClient("publisher");
  return _publisher;
}

export function getSubscriber(): Redis {
  if (!_subscriber) _subscriber = createClient("subscriber");
  return _subscriber;
}

export async function closePubSubClients(): Promise<void> {
  await Promise.all([
    _publisher?.quit().catch(() => _publisher?.disconnect()),
    _subscriber?.quit().catch(() => _subscriber?.disconnect()),
  ]);
  _publisher = null;
  _subscriber = null;
}