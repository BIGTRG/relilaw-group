// Redis singleton (sessions, MFA challenges, lockouts, entitlement cache).
import Redis from 'ioredis';

let client;

export function getRedis() {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL is not set');
    client = new Redis(url, { maxRetriesPerRequest: 2 });
  }
  return client;
}
