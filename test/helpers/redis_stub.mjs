// Minimal in-memory Redis for tests: only the commands the app uses.
export function createRedisStub() {
  const store = new Map(); // key -> { value, expiresAt|null }
  const now = () => Date.now();
  const live = k => {
    const e = store.get(k);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt <= now()) { store.delete(k); return null; }
    return e;
  };
  return {
    async set(key, value, ...args) {
      let expiresAt = null;
      const prev = live(key);
      for (let i = 0; i < args.length; i++) {
        if (args[i] === 'EX') expiresAt = now() + Number(args[++i]) * 1000;
        if (args[i] === 'KEEPTTL') expiresAt = prev ? prev.expiresAt : null;
      }
      store.set(key, { value: String(value), expiresAt });
      return 'OK';
    },
    async get(key) { return live(key)?.value ?? null; },
    async getdel(key) {
      const v = live(key)?.value ?? null;
      store.delete(key);
      return v;
    },
    async del(...keys) {
      let n = 0;
      for (const k of keys.flat()) if (store.delete(k)) n++;
      return n;
    },
    async incr(key) {
      const v = (Number(live(key)?.value) || 0) + 1;
      const prev = live(key);
      store.set(key, { value: String(v), expiresAt: prev?.expiresAt ?? null });
      return v;
    },
    async expire(key, seconds) {
      const e = live(key);
      if (!e) return 0;
      e.expiresAt = now() + seconds * 1000;
      return 1;
    },
    async exists(...keys) { return keys.flat().filter(k => live(k)).length; },
    _dump() { return store; },
  };
}
