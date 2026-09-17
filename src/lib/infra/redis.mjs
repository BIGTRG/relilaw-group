// Redis singleton (sessions, MFA challenges, lockouts, entitlement cache).
import Redis from 'ioredis';

let client;

export function getRedis() {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL is not set');
    client = new Redis(url, { maxRetriesPerRequest: 2 });
    // GETDEL arrived in Redis 6.2; the fleet runs 6.0. Same atomic semantics
    // through MULTI so callers can keep the one-liner.
    client.getdel = async key => {
      const [[, value]] = await client.multi().get(key).del(key).exec();
      return value;
    };
  }
  return client;
}
