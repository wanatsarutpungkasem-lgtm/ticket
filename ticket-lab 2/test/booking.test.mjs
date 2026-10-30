import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookingEngine } from '../booking.mjs';
import { createLabServer } from '../server.mjs';

const selection = { show: 'A', zone: 'LA2', seats: ['B4', 'B5'] };
function lab(options = {}) {
  let time = 100000;
  const engine = createBookingEngine({ now: () => time, gateDelay: 0, ...options });
  const user = () => engine.createSession().token;
  return { engine, user, advance: ms => { time += ms; } };
}
const code = expected => error => error.code === expected;

test('inventory and booking require queue admission, not just a valid session', () => {
  const { engine, user } = lab({ gateDelay: 3000 }); const id = user();
  assert.equal(engine.join(id).state, 'waiting');
  assert.throws(() => engine.inventory(id, 'A', 'LA2'), code('QUEUE_REQUIRED'));
  assert.throws(() => engine.hold(id, selection), code('QUEUE_REQUIRED'));
});
test('FIFO queue enforces capacity and joining again never upgrades a position', () => {
  const { engine, user } = lab({ capacity: 1 }); const a = user(), b = user(), c = user();
  assert.equal(engine.join(a).state, 'admitted');
  assert.equal(engine.join(b).position, 1);
  assert.equal(engine.join(c).position, 2);
  assert.equal(engine.join(c).position, 2);
  engine.leave(a);
  assert.equal(engine.queueStatus(b).state, 'admitted');
  assert.equal(engine.queueStatus(c).position, 1);
});
test('gate opens only after its configured server time', () => {
  const { engine, user, advance } = lab({ gateDelay: 3000 }); const id = user();
  engine.join(id); advance(2999);
  assert.equal(engine.queueStatus(id).state, 'waiting'); advance(1);
  assert.equal(engine.queueStatus(id).state, 'admitted');
});
test('competing buyers cannot hold the same seats and multi-seat writes are all or nothing', () => {
  const { engine, user } = lab(); const a = user(), b = user(); engine.join(a); engine.join(b);
  engine.hold(a, selection);
  assert.throws(() => engine.hold(b, { ...selection, seats: ['B5', 'B6'] }), code('SEAT_TAKEN'));
  assert.equal(engine.inventory(b, 'A', 'LA2').seats.find(s => s.id === 'B6').state, 'available');
  assert.equal(engine.inventory(b, 'A', 'LA2').seats.find(s => s.id === 'B5').mine, false);
});
test('expired holds return to inventory and cannot be confirmed', () => {
  const { engine, user, advance } = lab(); const a = user(), b = user(); engine.join(a); engine.join(b);
  const hold = engine.hold(a, selection); advance(45000);
  assert.equal(engine.holdStatus(a, hold.id).state, 'expired');
  assert.throws(() => engine.confirm(a, hold.id), code('HOLD_EXPIRED'));
  const next = engine.hold(b, selection); assert.equal(next.state, 'held');
});
test('one buyer cannot read, release or confirm another buyer hold', () => {
  const { engine, user } = lab(); const a = user(), b = user(); engine.join(a); engine.join(b);
  const hold = engine.hold(a, selection);
  for (const op of ['holdStatus', 'release', 'confirm']) assert.throws(() => engine[op](b, hold.id), code('HOLD_NOT_FOUND'));
});
test('duplicate, nonexistent and non-adjacent selections fail without consuming seats', () => {
  const { engine, user } = lab(); const id = user(); engine.join(id);
  for (const seats of [['B4','B4'], ['Z1'], [], ['B4','B6'], ['A4','B5']]) {
    assert.throws(() => engine.hold(id, { ...selection, seats }));
  }
  assert.equal(engine.hold(id, selection).state, 'held');
  assert.throws(() => engine.hold(id, { ...selection, seats: ['C4','C5'] }), code('HOLD_EXISTS'));
});
test('confirmation is idempotent and booked seats cannot be sold again', () => {
  const { engine, user, advance } = lab(); const a = user(), b = user(); engine.join(a); engine.join(b);
  const hold = engine.hold(a, selection), order = engine.confirm(a, hold.id);
  assert.equal(order.simulation, true); assert.equal(order.total, 6400);
  advance(200000);
  assert.deepEqual(engine.confirm(a, hold.id), order);
  engine.join(b);
  assert.throws(() => engine.hold(b, selection), code('SEAT_TAKEN'));
});
test('leaving releases holds and admission, expired buyers rejoin at the tail', () => {
  const { engine, user, advance } = lab({ capacity: 1, permitTtl: 5000 });
  const a = user(), b = user(); engine.join(a); engine.join(b);
  const hold = engine.hold(a, selection); engine.leave(a);
  assert.equal(engine.holdStatus(a, hold.id).state, 'released');
  assert.equal(engine.queueStatus(b).state, 'admitted');
  advance(5001); assert.equal(engine.queueStatus(b).state, 'expired');
  engine.join(a); assert.equal(engine.join(b).position, 1);
});
test('real HTTP race: two simultaneous hold requests yield exactly one success', async t => {
  const server = createLabServer({ engine: createBookingEngine({ gateDelay: 0 }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, token, data) {
    return fetch(base + path, { method: data ? 'POST' : 'GET', headers: {
      ...(data ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  }
  const [a,b] = await Promise.all([request('/api/session', null, {}).then(r=>r.json()), request('/api/session', null, {}).then(r=>r.json())]);
  await Promise.all([request('/api/queue/join',a.token,{}),request('/api/queue/join',b.token,{})]);
  const responses = await Promise.all([request('/api/holds',a.token,selection),request('/api/holds',b.token,selection)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  const winner = responses[0].status === 201 ? a : b, winnerIndex = responses[0].status === 201 ? 0 : 1;
  const hold = await responses[winnerIndex].json();
  const confirmed = await request(`/api/holds/${hold.id}/confirm`,winner.token,{});
  assert.equal(confirmed.status,200); assert.equal((await confirmed.json()).simulation,true);
  assert.equal((await request('/api/seats?show=A&zone=LA2')).status,401);
  const foreign = await fetch(base+'/api/session',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'});
  assert.equal(foreign.status,403);
  const invalid = await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'null'});
  assert.equal(invalid.status,400);
  const page = await request('/'); assert.equal(page.status,200);
  assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);
  const panel = await request('/pilot-panel.js'); assert.equal(panel.status,200);
  assert.match(panel.headers.get('content-type'),/javascript/);
  assert.equal((await request('/pilot-panel.css')).status,200);
  assert.equal((await request('/ttm-fixture')).status,200);
  assert.equal((await request('/ttm-adapter.js')).status,200);
  assert.equal((await request('/popup.js')).status,200);
});
