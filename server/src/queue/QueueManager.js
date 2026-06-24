import { Redis } from '@upstash/redis';
import crypto from 'crypto';

const SEED_AVG_MS_DEFAULT = 300000;

export class QueueManager {
  constructor() {
    this.queue = [];
    this.currentToken = 0;
    this.nextToken = 1;
    this.callHistory = [];
    this.lastCallTimestamp = null;
    this.seedAvgMs = SEED_AVG_MS_DEFAULT;

    this.redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }

  addPatient(name) {
    const patient = {
      id: crypto.randomUUID(),
      name: name.trim(),
      token: this.nextToken++,
    };
    this.queue.push(patient);
    this.saveToRedis();
    return patient;
  }

  callNext() {
    if (this.queue.length === 0) return null;

    const now = Date.now();

    if (this.lastCallTimestamp !== null) {
      const intervalMs = now - this.lastCallTimestamp;
      if (intervalMs > 10_000 && intervalMs < 7_200_000) {
        this.callHistory.push(intervalMs);
        if (this.callHistory.length > 5) {
          this.callHistory.shift();
        }
      }
    }

    this.lastCallTimestamp = now;
    this.currentToken = this.queue[0].token;
    this.queue.shift();

    this.saveToRedis();
    return this.getState();
  }

  getRollingAvgMs() {
    if (this.callHistory.length < 1) return null;

    const sum = this.callHistory.reduce((acc, ms) => acc + ms, 0);
    return Math.round(sum / this.callHistory.length);
  }

  getState() {
    return {
      queue: this.queue,
      currentToken: this.currentToken,
      nextToken: this.nextToken,
      callHistory: this.callHistory,
      seedAvgMs: this.seedAvgMs,
      rollingAvgMs: this.getRollingAvgMs(),
    };
  }

  async saveToRedis() {
    try {
      await this.redis.set('clinic:queue', JSON.stringify({
        queue: this.queue,
        currentToken: this.currentToken,
        nextToken: this.nextToken,
        callHistory: this.callHistory,
        seedAvgMs: this.seedAvgMs,
        lastCallTimestamp: this.lastCallTimestamp,
      }));
    } catch (err) {
      console.error('Redis save failed (non-fatal):', err.message);
    }
  }

  async loadFromRedis() {
    try {
      const data = await this.redis.get('clinic:queue');
      if (data) {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        this.queue = parsed.queue || [];
        this.currentToken = parsed.currentToken || 0;
        this.nextToken = parsed.nextToken || 1;
        this.callHistory = parsed.callHistory || [];
        this.seedAvgMs = parsed.seedAvgMs || SEED_AVG_MS_DEFAULT;
        this.lastCallTimestamp = parsed.lastCallTimestamp ?? null;
      }
    } catch (err) {
      console.warn('Redis load failed (proceeding empty):', err.message);
    }
  }

  isEmpty() {
    return this.queue.length === 0;
  }

  async setSeedAvg(ms) {
    this.seedAvgMs = ms;
    await this.saveToRedis();
  }
}
