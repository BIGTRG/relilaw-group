// A tiny RESP2 server for the end-to-end tests: exactly the commands the app
// uses (GET SET DEL INCR EXPIRE EXISTS MULTI EXEC PING INFO), with EX/PX/KEEPTTL.
// The unit tests use redis_stub.mjs in-process; the running Next server needs
// a socket, so this speaks the wire protocol. Not a Redis. Never for production.
import net from 'node:net';

export function startFakeRedis() {
  const store = new Map(); // key -> { value, expiresAt|null }
  const live = k => {
    const e = store.get(k);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) { store.delete(k); return null; }
    return e;
  };
  const enc = {
    ok: () => '+OK\r\n',
    int: n => `:${n}\r\n`,
    bulk: s => (s === null ? '$-1\r\n' : `$${Buffer.byteLength(s)}\r\n${s}\r\n`),
    err: m => `-ERR ${m}\r\n`,
    arr: parts => `*${parts.length}\r\n${parts.join('')}`,
  };
  function run(args) {
    const cmd = String(args[0] ?? '').toUpperCase();
    switch (cmd) {
      case 'PING': return '+PONG\r\n';
      case 'INFO': return enc.bulk('# Server\r\nredis_version:6.0.16\r\n');
      case 'GET': return enc.bulk(live(args[1])?.value ?? null);
      case 'SET': {
        const [, key, value, ...rest] = args;
        let expiresAt = null;
        const prev = live(key);
        for (let i = 0; i < rest.length; i++) {
          const o = String(rest[i]).toUpperCase();
          if (o === 'EX') expiresAt = Date.now() + Number(rest[++i]) * 1000;
          else if (o === 'PX') expiresAt = Date.now() + Number(rest[++i]);
          else if (o === 'KEEPTTL') expiresAt = prev ? prev.expiresAt : null;
        }
        store.set(key, { value: String(value), expiresAt });
        return enc.ok();
      }
      case 'DEL': { let n = 0; for (const k of args.slice(1)) if (live(k)) { store.delete(k); n++; } return enc.int(n); }
      case 'EXISTS': return enc.int(args.slice(1).filter(k => live(k)).length);
      case 'INCR': { const e = live(args[1]); const v = (e ? Number(e.value) : 0) + 1; store.set(args[1], { value: String(v), expiresAt: e?.expiresAt ?? null }); return enc.int(v); }
      case 'EXPIRE': { const e = live(args[1]); if (!e) return enc.int(0); e.expiresAt = Date.now() + Number(args[2]) * 1000; return enc.int(1); }
      case 'TTL': { const e = live(args[1]); if (!e) return enc.int(-2); return enc.int(e.expiresAt === null ? -1 : Math.ceil((e.expiresAt - Date.now()) / 1000)); }
      case 'CLIENT': case 'SELECT': return enc.ok();
      default: return enc.err(`unknown command '${cmd}'`);
    }
  }
  const server = net.createServer(sock => {
    let buf = Buffer.alloc(0);
    let queue = null; // MULTI
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const parsed = parseOne(buf);
        if (!parsed) break;
        buf = buf.subarray(parsed.len);
        const args = parsed.args;
        const cmd = String(args[0] ?? '').toUpperCase();
        if (cmd === 'MULTI') { queue = []; sock.write(enc.ok()); continue; }
        if (cmd === 'EXEC') { const out = (queue ?? []).map(run); queue = null; sock.write(enc.arr(out)); continue; }
        if (queue) { queue.push(args); sock.write('+QUEUED\r\n'); continue; }
        sock.write(run(args));
      }
    });
    sock.on('error', () => {});
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ port, url: `redis://127.0.0.1:${port}`, store, stop: () => new Promise(r => server.close(() => r())) });
    });
  });
}

/** Parse one RESP array of bulk strings from the buffer, or null if incomplete. */
function parseOne(buf) {
  if (buf.length === 0 || buf[0] !== 0x2a) return null; // '*'
  let pos = buf.indexOf('\r\n');
  if (pos < 0) return null;
  const n = Number(buf.subarray(1, pos).toString());
  pos += 2;
  const args = [];
  for (let i = 0; i < n; i++) {
    if (buf[pos] !== 0x24) return null; // '$'
    const e = buf.indexOf('\r\n', pos);
    if (e < 0) return null;
    const len = Number(buf.subarray(pos + 1, e).toString());
    const start = e + 2;
    if (buf.length < start + len + 2) return null;
    args.push(buf.subarray(start, start + len).toString());
    pos = start + len + 2;
  }
  return { args, len: pos };
}
