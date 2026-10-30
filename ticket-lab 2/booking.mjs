import { randomUUID } from 'node:crypto';

export class BookingError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
const fail = (status, code, message) => { throw new BookingError(status, code, message); };

// Every state-changing method is synchronous: validation and writes finish in the
// same event-loop turn. This is atomic only inside this single Node.js process.
export function createBookingEngine({ now = Date.now, gateDelay = 3000,
  permitTtl = 120000, holdTtl = 45000, capacity = 2 } = {}) {
  const opensAt = now() + gateDelay;
  const sessions = new Map(), holds = new Map(), orders = new Map();
  const queue = [];
  const zones = [
    { id: 'LA2', price: 3200 }, { id: 'RA2', price: 3200 },
    { id: 'LB2', price: 2600 }, { id: 'RB2', price: 2600 }
  ];
  const shows = [{ id: 'A', label: 'รอบ A · 19:00' }, { id: 'B', label: 'รอบ B · 19:00' }];
  const seats = new Map();
  for (const show of shows) for (const zone of zones) for (const row of 'ABCD') {
    for (let n = 1; n <= 10; n++) {
      const key = `${show.id}/${zone.id}/${row}${n}`;
      seats.set(key, { id: `${row}${n}`, row, number: n, show: show.id,
        zone: zone.id, state: n === 1 || (row === 'D' && n > 6) ? 'booked' : 'available', holdId: null });
    }
  }
  function session(id) {
    const value = sessions.get(id);
    if (!value) fail(401, 'SESSION_REQUIRED', 'เริ่มผู้ซื้อทดสอบใหม่ก่อน');
    value.lastSeen = now();
    return value;
  }
  function sweep() {
    const time = now();
    for (const hold of holds.values()) {
      if (hold.state === 'held' && hold.expiresAt <= time) {
        hold.state = 'expired';
        for (const key of hold.keys) {
          const seat = seats.get(key);
          if (seat.holdId === hold.id) { seat.state = 'available'; seat.holdId = null; }
        }
      }
    }
    for (const user of sessions.values()) {
      if (user.state === 'admitted' && user.permitUntil <= time) user.state = 'expired';
    }
    if (time < opensAt) return;
    let free = capacity - [...sessions.values()].filter(s => s.state === 'admitted').length;
    while (free > 0 && queue.length) {
      const user = sessions.get(queue.shift());
      if (!user || user.state !== 'waiting') continue;
      user.state = 'admitted'; user.permitUntil = time + permitTtl; free--;
    }
  }
  function requirePermit(id) {
    sweep();
    const user = session(id);
    if (user.state !== 'admitted') fail(403, 'QUEUE_REQUIRED', 'ต้องได้รับสิทธิ์จากคิวก่อน');
    return user;
  }
  function coordinates(show, zone) {
    if (!shows.some(s => s.id === show) || !zones.some(z => z.id === zone)) {
      fail(400, 'INVALID_ZONE', 'ไม่พบรอบหรือโซนทดสอบนี้');
    }
  }
  function ownedHold(id, holdId) {
    const user = session(id), hold = holds.get(holdId);
    if (!hold || hold.owner !== user.id) fail(404, 'HOLD_NOT_FOUND', 'ไม่พบการล็อกที่นั่งของคุณ');
    return hold;
  }
  function holdView(hold) {
    return { id: hold.id, show: hold.show, zone: hold.zone, seats: hold.seatIds,
      state: hold.state, expiresAt: hold.expiresAt, total: hold.total, currency: 'THB', simulation: true };
  }
  return {
    info() {
      sweep();
      return { name: 'NEON CITY / Ticket Lab', simulation: true, opensAt, capacity,
        holdSeconds: holdTtl / 1000, permitSeconds: permitTtl / 1000, shows, zones };
    },
    createSession() {
      if (sessions.size >= 1000) fail(429, 'LAB_FULL', 'ผู้ซื้อทดสอบเต็ม รีสตาร์ตเซิร์ฟเวอร์เพื่อเริ่มชุดใหม่');
      const id = randomUUID();
      sessions.set(id, { id, state: 'new', permitUntil: 0, lastSeen: now() });
      return { token: id, buyer: `DEMO-${sessions.size.toString().padStart(4, '0')}`, simulation: true };
    },
    join(id) {
      sweep(); const user = session(id);
      if (user.state === 'new' || user.state === 'expired' || user.state === 'left') {
        user.state = 'waiting'; queue.push(id);
      }
      return this.queueStatus(id);
    },
    queueStatus(id) {
      sweep(); const user = session(id);
      return { state: user.state, position: user.state === 'waiting' ? queue.indexOf(id) + 1 : null,
        opensAt, permitUntil: user.permitUntil, serverNow: now() };
    },
    leave(id) {
      sweep(); const user = session(id);
      for (const hold of holds.values()) {
        if (hold.owner === id && hold.state === 'held') this.release(id, hold.id);
      }
      const index = queue.indexOf(id); if (index >= 0) queue.splice(index, 1);
      if (user.state !== 'completed') user.state = 'left';
      sweep(); return { state: user.state };
    },
    inventory(id, show, zone) {
      requirePermit(id); coordinates(show, zone);
      return { show, zone, serverNow: now(), seats: [...seats.values()]
        .filter(s => s.show === show && s.zone === zone)
        .map(s => ({ id: s.id, row: s.row, number: s.number, state: s.state,
          mine: s.holdId !== null && holds.get(s.holdId)?.owner === id })) };
    },
    hold(id, { show, zone, seats: seatIds, adjacent = true } = {}) {
      requirePermit(id); coordinates(show, zone);
      if (!Array.isArray(seatIds) || seatIds.length < 1 || seatIds.length > 4 ||
        new Set(seatIds).size !== seatIds.length || seatIds.some(s => typeof s !== 'string' || !/^[A-D](?:10|[1-9])$/.test(s))) {
        fail(400, 'INVALID_SEATS', 'เลือกที่นั่งที่ไม่ซ้ำกัน 1–4 ที่');
      }
      if ([...holds.values()].some(h => h.owner === id && h.state === 'held')) {
        fail(409, 'HOLD_EXISTS', 'ปล่อยที่นั่งเดิมก่อนเลือกใหม่');
      }
      const keys = seatIds.map(s => `${show}/${zone}/${s}`), requested = keys.map(k => seats.get(k));
      const sorted = [...requested].sort((a, b) => a.number - b.number);
      if (adjacent !== false && (sorted.some(s => s.row !== sorted[0].row) ||
        sorted.some((s, i) => i > 0 && s.number !== sorted[i - 1].number + 1))) {
        fail(400, 'NOT_ADJACENT', 'ที่นั่งต้องอยู่แถวเดียวกันและติดกัน');
      }
      if (requested.some(s => s.state !== 'available')) fail(409, 'SEAT_TAKEN', 'มีคนล็อกหรือจองที่นั่งนี้แล้ว');
      const hold = { id: randomUUID(), owner: id, show, zone, keys, seatIds: [...seatIds],
        state: 'held', expiresAt: now() + holdTtl, total: zones.find(z => z.id === zone).price * seatIds.length };
      holds.set(hold.id, hold);
      for (const seat of requested) { seat.state = 'held'; seat.holdId = hold.id; }
      return holdView(hold);
    },
    holdStatus(id, holdId) { sweep(); return holdView(ownedHold(id, holdId)); },
    release(id, holdId) {
      sweep(); const hold = ownedHold(id, holdId);
      if (hold.state === 'held') {
        for (const key of hold.keys) {
          const seat = seats.get(key);
          if (seat.holdId === hold.id) { seat.state = 'available'; seat.holdId = null; }
        }
        hold.state = 'released';
      }
      return holdView(hold);
    },
    confirm(id, holdId) {
      sweep(); const hold = ownedHold(id, holdId);
      // Retrying the same confirmation cannot produce another order.
      if (hold.orderId) return orders.get(hold.orderId);
      requirePermit(id);
      if (hold.state !== 'held') fail(409, 'HOLD_EXPIRED', 'การล็อกหมดอายุหรือถูกปล่อยแล้ว กรุณาเลือกใหม่');
      if (hold.keys.some(k => seats.get(k).holdId !== hold.id || seats.get(k).state !== 'held')) {
        fail(409, 'HOLD_CONFLICT', 'ที่นั่งไม่อยู่ในการล็อกนี้');
      }
      const order = { id: `DEMO-${randomUUID().slice(0, 8).toUpperCase()}`, show: hold.show,
        zone: hold.zone, seats: hold.seatIds, total: hold.total, currency: 'THB',
        createdAt: now(), simulation: true, payment: 'simulated-no-charge' };
      for (const key of hold.keys) { const seat = seats.get(key); seat.state = 'booked'; seat.holdId = null; }
      hold.state = 'confirmed'; hold.orderId = order.id; orders.set(order.id, order);
      session(id).state = 'completed'; sweep(); return order;
    }
  };
}
