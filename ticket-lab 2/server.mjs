import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createBookingEngine, BookingError } from './booking.mjs';

const publicDir = new URL('./public/', import.meta.url);
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/pilot-panel.js', ['../extension/content.js', 'text/javascript; charset=utf-8']],
  ['/pilot-panel.css', ['../extension/panel.css', 'text/css; charset=utf-8']],
  ['/ttm-fixture', ['ttm-fixture.html', 'text/html; charset=utf-8']],
  ['/ttm-fixture.css', ['ttm-fixture.css', 'text/css; charset=utf-8']],
  ['/ttm-fixture.js', ['ttm-fixture.js', 'text/javascript; charset=utf-8']],
  ['/popup.js', ['../extension/popup.js', 'text/javascript; charset=utf-8']],
  ['/popup.css', ['../extension/popup.css', 'text/css; charset=utf-8']],
  ['/ttm-adapter.js', ['../extension/ttm-adapter.js', 'text/javascript; charset=utf-8']]
]);
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
export function createLabServer({ engine = createBookingEngine() } = {}) {
  function json(res, status, body) {
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) {
      throw new BookingError(415, 'JSON_REQUIRED', 'ต้องใช้ application/json');
    }
    let size = 0, chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) throw new BookingError(413, 'TOO_LARGE', 'คำขอใหญ่เกินกำหนด');
      chunks.push(chunk);
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value;
    } catch { throw new BookingError(400, 'BAD_JSON', 'JSON ไม่ถูกต้อง'); }
  }
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (req.headers.origin && !['http:', 'https:'].includes(new URL(req.headers.origin).protocol)) {
          throw new BookingError(403, 'ORIGIN_DENIED', 'ไม่อนุญาต Origin นี้');
        }
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
          throw new BookingError(403, 'ORIGIN_DENIED', 'API ใช้ได้เฉพาะหน้าเว็บทดสอบเดียวกัน');
        }
        const key = `${req.method} ${url.pathname}`;
        if (key === 'GET /api/event') return json(res, 200, engine.info());
        if (key === 'POST /api/session') { await body(req); return json(res, 201, engine.createSession()); }
        const token = /^Bearer ([a-f0-9-]{36})$/.exec(req.headers.authorization || '')?.[1];
        if (!token) throw new BookingError(401, 'SESSION_REQUIRED', 'ต้องเริ่มผู้ซื้อทดสอบก่อน');
        if (key === 'POST /api/queue/join') { await body(req); return json(res, 200, engine.join(token)); }
        if (key === 'POST /api/queue/leave') { await body(req); return json(res, 200, engine.leave(token)); }
        if (key === 'GET /api/queue') return json(res, 200, engine.queueStatus(token));
        if (key === 'GET /api/seats') return json(res, 200, engine.inventory(token, url.searchParams.get('show'), url.searchParams.get('zone')));
        if (key === 'POST /api/holds') return json(res, 201, engine.hold(token, await body(req)));
        const match = /^\/api\/holds\/([a-f0-9-]{36})(?:\/(release|confirm))?$/.exec(url.pathname);
        if (match && req.method === 'GET' && !match[2]) return json(res, 200, engine.holdStatus(token, match[1]));
        if (match && req.method === 'POST' && match[2]) {
          await body(req);
          return json(res, 200, match[2] === 'release' ? engine.release(token, match[1]) : engine.confirm(token, match[1]));
        }
        return json(res, 404, { error: 'NOT_FOUND', message: 'ไม่พบ API' });
      }
      const asset = assets.get(url.pathname);
      if (!asset || !['GET', 'HEAD'].includes(req.method)) return json(res, 404, { error: 'NOT_FOUND' });
      const data = await readFile(new URL(asset[0], publicDir));
      res.writeHead(200, { ...headers, 'Content-Type': asset[1] });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (res.headersSent) return res.end();
      const known = error instanceof BookingError;
      if (!known) console.error('Lab request failed:', error.message);
      json(res, known ? error.status : 500, { error: known ? error.code : 'SERVER_ERROR',
        message: known ? error.message : 'เซิร์ฟเวอร์ทดสอบผิดพลาด' });
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 5208), host = process.env.HOST || '127.0.0.1';
  const server = createLabServer();
  server.listen(port, host, () => console.log(`Ticket Lab: http://${host}:${port}\nLocal sandbox only. State resets on restart.`));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
}
