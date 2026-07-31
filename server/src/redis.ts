import Redis from 'ioredis';

import { config } from './config';
import { logger } from './logger';

/**
 * Shared state store. Holds the per-user photo-submission rate limit and short-lived
 * caches, so Node stays stateless and horizontally scalable.
 *
 * Locally it is optional: without REDIS_URL we fall back to an in-process implementation
 * that satisfies the same interface. That fallback is correct for exactly one instance,
 * which is why config.ts refuses to boot in production without a real Redis URL — a
 * per-instance rate limit is a rate limit multiplied by the instance count.
 *
 * The pub/sub and sorted-set methods are retained because they cost nothing to keep and
 * the leaderboard cache will want them; nothing uses them today.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Atomic compare-and-set. Returns false if the key already existed. */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, member: string): Promise<void>;
  zrangebyscore(key: string, min: number, max: number): Promise<string[]>;
  incrBy(key: string, amount: number, ttlSeconds: number): Promise<number>;
  publish(channel: string, payload: string): Promise<void>;
  subscribe(channel: string, handler: (payload: string) => void): Promise<void>;
  quit(): Promise<void>;
}

class RedisStore implements KeyValueStore {
  private subscriber: Redis | null = null;

  constructor(private readonly client: Redis) {}

  async get(key: string) {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    if (ttlSeconds) await this.client.set(key, value, 'EX', ttlSeconds);
    else await this.client.set(key, value);
  }

  async del(key: string) {
    await this.client.del(key);
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number) {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async zadd(key: string, score: number, member: string) {
    await this.client.zadd(key, score, member);
  }

  async zrem(key: string, member: string) {
    await this.client.zrem(key, member);
  }

  async zrangebyscore(key: string, min: number, max: number) {
    return this.client.zrangebyscore(key, min, max);
  }

  async incrBy(key: string, amount: number, ttlSeconds: number) {
    const value = await this.client.incrby(key, amount);
    if (value === amount) await this.client.expire(key, ttlSeconds);
    return value;
  }

  async publish(channel: string, payload: string) {
    await this.client.publish(channel, payload);
  }

  async subscribe(channel: string, handler: (payload: string) => void) {
    // A subscribed connection cannot issue normal commands, so it needs its own client.
    if (!this.subscriber) this.subscriber = this.client.duplicate();
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, payload) => {
      if (ch === channel) handler(payload);
    });
  }

  async quit() {
    await this.subscriber?.quit();
    await this.client.quit();
  }
}

/** Single-instance fallback. Correct for local dev, never for production. */
class MemoryStore implements KeyValueStore {
  private kv = new Map<string, { value: string; expiresAt: number | null }>();
  private zsets = new Map<string, Map<string, number>>();
  private channels = new Map<string, ((payload: string) => void)[]>();

  private alive(key: string) {
    const entry = this.kv.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.kv.delete(key);
      return null;
    }
    return entry;
  }

  async get(key: string) {
    return this.alive(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    this.kv.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string) {
    this.kv.delete(key);
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number) {
    if (this.alive(key)) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }

  async zadd(key: string, score: number, member: string) {
    const set = this.zsets.get(key) ?? new Map<string, number>();
    set.set(member, score);
    this.zsets.set(key, set);
  }

  async zrem(key: string, member: string) {
    this.zsets.get(key)?.delete(member);
  }

  async zrangebyscore(key: string, min: number, max: number) {
    const set = this.zsets.get(key);
    if (!set) return [];
    return [...set.entries()]
      .filter(([, score]) => score >= min && score <= max)
      .sort((a, b) => a[1] - b[1])
      .map(([member]) => member);
  }

  async incrBy(key: string, amount: number, ttlSeconds: number) {
    const current = Number(this.alive(key)?.value ?? '0');
    const next = current + amount;
    await this.set(key, String(next), ttlSeconds);
    return next;
  }

  async publish(channel: string, payload: string) {
    for (const handler of this.channels.get(channel) ?? []) handler(payload);
  }

  async subscribe(channel: string, handler: (payload: string) => void) {
    const list = this.channels.get(channel) ?? [];
    list.push(handler);
    this.channels.set(channel, list);
  }

  async quit() {
    this.kv.clear();
    this.zsets.clear();
    this.channels.clear();
  }
}

function build(): KeyValueStore {
  if (!config.REDIS_URL) {
    logger.warn(
      'REDIS_URL is not set — using the in-process store. Valid for a single instance only.'
    );
    return new MemoryStore();
  }

  const client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

  client.on('error', (err) => logger.error({ err }, 'redis error'));
  client.on('connect', () => logger.info('redis connected'));

  return new RedisStore(client);
}

export const store: KeyValueStore = build();
