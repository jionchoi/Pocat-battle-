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

  /* ------------------------------------------------------------------ */
  /* Feed ranking and counters                                          */
  /* ------------------------------------------------------------------ */

  /**
   * One round trip for a whole batch of ranking writes.
   *
   * The impression path touches ~24 keys per request. Twenty-four sequential awaits is
   * twenty-four network round trips, which at feed volume is the dominant cost of the
   * entire operation — far more than the work Redis actually does.
   */
  pipeline(ops: PipelineOp[]): Promise<void>;

  /** Top `count` members by score, highest first, starting at `offset`. */
  zrevrange(key: string, offset: number, count: number): Promise<string[]>;
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  zcard(key: string): Promise<number>;

  /**
   * HyperLogLog cardinality — unique viewers of one photo.
   *
   * A row per (photo, viewer) is the exact answer and it is unaffordable: at feed scale
   * that table grows by millions of rows a second and every read of it is an aggregate.
   * HLL answers "how many distinct viewers" in a fixed ~12KB with 0.81% error, which is
   * the correct trade for a number that is the *denominator of a ratio* rather than
   * anything anyone is paid on.
   */
  pfcount(keys: string[]): Promise<number[]>;

  hgetall(key: string): Promise<Record<string, string>>;
  /** Pops up to `count` members. Used to drain the dirty-photo set in a flush job. */
  spop(key: string, count: number): Promise<string[]>;
  mget(keys: string[]): Promise<(string | null)[]>;
}

/**
 * The subset of write commands the feed pipelines.
 *
 * A tagged union rather than exposing ioredis' pipeline object, so the memory fallback can
 * implement the same semantics and nothing outside this file depends on ioredis' shape.
 */
export type PipelineOp =
  | { op: 'zadd'; key: string; score: number; member: string }
  | { op: 'zrem'; key: string; member: string }
  | { op: 'pfadd'; key: string; value: string; ttlSeconds?: number }
  | { op: 'hincrby'; key: string; field: string; amount: number; ttlSeconds?: number }
  | { op: 'sadd'; key: string; member: string }
  | { op: 'expire'; key: string; ttlSeconds: number };

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

  async pipeline(ops: PipelineOp[]) {
    if (ops.length === 0) return;

    const pipe = this.client.pipeline();

    for (const op of ops) {
      switch (op.op) {
        case 'zadd':
          pipe.zadd(op.key, op.score, op.member);
          break;
        case 'zrem':
          pipe.zrem(op.key, op.member);
          break;
        case 'pfadd':
          pipe.pfadd(op.key, op.value);
          if (op.ttlSeconds) pipe.expire(op.key, op.ttlSeconds);
          break;
        case 'hincrby':
          pipe.hincrby(op.key, op.field, op.amount);
          if (op.ttlSeconds) pipe.expire(op.key, op.ttlSeconds);
          break;
        case 'sadd':
          pipe.sadd(op.key, op.member);
          break;
        case 'expire':
          pipe.expire(op.key, op.ttlSeconds);
          break;
      }
    }

    await pipe.exec();
  }

  async zrevrange(key: string, offset: number, count: number) {
    return this.client.zrevrange(key, offset, offset + count - 1);
  }

  async zremrangebyscore(key: string, min: number, max: number) {
    return this.client.zremrangebyscore(key, min, max);
  }

  async zcard(key: string) {
    return this.client.zcard(key);
  }

  async pfcount(keys: string[]) {
    if (keys.length === 0) return [];

    // One PFCOUNT per key, pipelined. A single multi-key PFCOUNT would return the union's
    // cardinality — the number of people who saw *any* of these photos — which is a
    // different question and not the one being asked.
    const pipe = this.client.pipeline();
    for (const key of keys) pipe.pfcount(key);
    const results = await pipe.exec();

    return (results ?? []).map(([err, value]) => (err ? 0 : Number(value ?? 0)));
  }

  async hgetall(key: string) {
    return this.client.hgetall(key);
  }

  async spop(key: string, count: number) {
    return this.client.spop(key, count);
  }

  async mget(keys: string[]) {
    if (keys.length === 0) return [];
    return this.client.mget(keys);
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
  private hashes = new Map<string, Map<string, number>>();
  private sets = new Map<string, Set<string>>();
  /**
   * Exact sets where Redis would use a HyperLogLog.
   *
   * Deliberately exact rather than a JS HLL implementation: locally there are tens of
   * viewers, so the sketch's error would be the *only* thing you ever saw, and a
   * approximate local count would make every seeded number impossible to reason about.
   * The interface is identical, which is what actually has to match.
   */
  private hlls = new Map<string, Set<string>>();
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

  async pipeline(ops: PipelineOp[]) {
    for (const op of ops) {
      switch (op.op) {
        case 'zadd':
          await this.zadd(op.key, op.score, op.member);
          break;
        case 'zrem':
          await this.zrem(op.key, op.member);
          break;
        case 'pfadd': {
          const set = this.hlls.get(op.key) ?? new Set<string>();
          set.add(op.value);
          this.hlls.set(op.key, set);
          break;
        }
        case 'hincrby': {
          const hash = this.hashes.get(op.key) ?? new Map<string, number>();
          hash.set(op.field, (hash.get(op.field) ?? 0) + op.amount);
          this.hashes.set(op.key, hash);
          break;
        }
        case 'sadd': {
          const set = this.sets.get(op.key) ?? new Set<string>();
          set.add(op.member);
          this.sets.set(op.key, set);
          break;
        }
        case 'expire':
          // No eviction in the fallback. The process is the lifetime.
          break;
      }
    }
  }

  async zrevrange(key: string, offset: number, count: number) {
    const set = this.zsets.get(key);
    if (!set) return [];

    return [...set.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(offset, offset + count)
      .map(([member]) => member);
  }

  async zremrangebyscore(key: string, min: number, max: number) {
    const set = this.zsets.get(key);
    if (!set) return 0;

    let removed = 0;
    for (const [member, score] of [...set.entries()]) {
      if (score >= min && score <= max) {
        set.delete(member);
        removed += 1;
      }
    }
    return removed;
  }

  async zcard(key: string) {
    return this.zsets.get(key)?.size ?? 0;
  }

  async pfcount(keys: string[]) {
    return keys.map((key) => this.hlls.get(key)?.size ?? 0);
  }

  async hgetall(key: string) {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    return Object.fromEntries([...hash.entries()].map(([k, v]) => [k, String(v)]));
  }

  async spop(key: string, count: number) {
    const set = this.sets.get(key);
    if (!set) return [];

    const taken = [...set].slice(0, count);
    for (const member of taken) set.delete(member);
    return taken;
  }

  async mget(keys: string[]) {
    return Promise.all(keys.map((key) => this.get(key)));
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
    this.hashes.clear();
    this.sets.clear();
    this.hlls.clear();
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
