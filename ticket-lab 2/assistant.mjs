// Standalone assistant for this localhost lab only. It does not accept a target URL.
import { setTimeout as sleep } from 'node:timers/promises';
const args = new Set(process.argv.slice(2));
const allowed = new Set(['--confirm', '--help']);
if ([...args].some(arg => !allowed.has(arg))) {
  console.error('Usage: npm run assistant -- [--confirm]'); process.exit(1);
}
if (args.has('--help')) {
  console.log('Connect to the local Ticket Lab, queue normally and hold two adjacent seats.\n--confirm confirms a simulated order (no payment).');
  process.exit(0);
}
const port = Number(process.env.LAB_PORT || 5208);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid LAB_PORT');
const base = `http://127.0.0.1:${port}/api`;
let token, completed = false, cleanupDone = false;
async function api(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, signal: AbortSignal.timeout(8000),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.message || 'Request failed'); error.code = data.error; throw error; }
  console.log(`${response.status} ${method} ${path}`); return data;
}
async function cleanup() {
  if (!token || completed || cleanupDone) return;
  cleanupDone = true;
  await api('/queue/leave', 'POST').catch(() => {});
}
process.once('SIGINT', async () => { await cleanup(); process.exit(130); });
process.once('SIGTERM', async () => { await cleanup(); process.exit(143); });
try {
  const event = await api('/event');
  if (event.simulation !== true || event.name !== 'NEON CITY / Ticket Lab') throw new Error('This is not the expected lab');
  ({ token } = await api('/session', 'POST'));
  await api('/queue/join', 'POST');
  const deadline = Date.now() + 180000;
  for (;;) {
    const queue = await api('/queue');
    if (queue.state === 'admitted') break;
    if (Date.now() >= deadline || queue.state !== 'waiting') throw new Error('Queue wait ended without admission');
    console.log(`Waiting normally, position ${queue.position}`); await sleep(1000);
  }
  let hold;
  for (const zone of ['LA2', 'RA2']) {
    const { seats } = await api(`/seats?show=A&zone=${zone}`);
    let pair;
    for (const first of seats) {
      if (first.state !== 'available') continue;
      const next = seats.find(s => s.row === first.row && s.number === first.number + 1 && s.state === 'available');
      if (next) { pair = [first.id, next.id]; break; }
    }
    if (!pair) continue;
    try { hold = await api('/holds', 'POST', { show: 'A', zone, seats: pair, adjacent: true }); break; }
    catch (error) { if (error.code !== 'SEAT_TAKEN') throw error; }
  }
  if (!hold) throw new Error('No adjacent pair found in the two configured zones');
  console.log(`Held ${hold.zone}: ${hold.seats.join(', ')} (sandbox only)`);
  if (args.has('--confirm')) {
    const order = await api(`/holds/${hold.id}/confirm`, 'POST'); completed = true;
    console.log(JSON.stringify(order, null, 2));
  } else {
    console.log('No --confirm supplied: demonstration complete; releasing seats and queue slot.');
  }
} catch (error) {
  console.error(`Assistant stopped: ${error.message}`); process.exitCode = 1;
} finally { await cleanup(); }
