// This client calls only the lab server on the same origin. No external adapter.
const $ = id => document.getElementById(id);
let token = sessionStorage.getItem('ticket-lab-token'), buyer = sessionStorage.getItem('ticket-lab-buyer');
let event, config, active = false, current = 'idle', run = 0, busy = false;
let viewZone = 'LA2', inventory = [], selected = [], hold = null, permitUntil = 0;
let botAttempted = false, serverOffset = 0, networkFailures = 0;
const pagesDemo = location.hostname.endsWith('.github.io');
const demo = { state: 'new', opensAt: Date.now() + 1500, permitUntil: 0, hold: null,
  booked: new Set(), buyerNumber: 0 };
const money = n => `฿${n.toLocaleString('th-TH')}`;
const clock = () => Date.now() + serverOffset;
function log(text) {
  const line = `[${new Date().toLocaleTimeString('th-TH')}] ${text}`;
  $('log').textContent = [...$('log').textContent.split('\n').filter(Boolean).slice(-79), line].join('\n');
  $('log').scrollTop = $('log').scrollHeight;
}
function message(text = '') { $('message').textContent = text; $('message').hidden = !text; }
function demoError(code, text) { const error = new Error(text); error.code = code; throw error; }
function expireDemoHold() {
  if (demo.hold?.state === 'held' && demo.hold.expiresAt <= Date.now()) demo.hold.state = 'expired';
}
function demoSeats(show, zone) {
  expireDemoHold();
  return [...'ABCD'].flatMap(row => Array.from({ length: 10 }, (_, index) => {
    const number = index + 1, id = `${row}${number}`, key = `${show}/${zone}/${id}`;
    const held = demo.hold?.state === 'held' && demo.hold.show === show &&
      demo.hold.zone === zone && demo.hold.seats.includes(id);
    return { id, row, number, state: demo.booked.has(key) || number === 1 || (row === 'D' && number > 6)
      ? 'booked' : held ? 'held' : 'available', mine: held };
  }));
}
async function demoApi(path, method, data) {
  await new Promise(resolve => setTimeout(resolve, 90));
  const url = new URL(path, location.origin);
  if (path === '/event') return { name: 'NEON CITY / Ticket Lab', simulation: true,
    opensAt: demo.opensAt, capacity: 2, holdSeconds: 45, permitSeconds: 120 };
  if (path === '/session' && method === 'POST') {
    demo.state = 'new'; demo.hold = null; demo.buyerNumber++;
    return { token: crypto.randomUUID(), buyer: `PAGES-${String(demo.buyerNumber).padStart(4, '0')}`, simulation: true };
  }
  if (path === '/queue/join' && method === 'POST') {
    demo.state = 'waiting'; demo.opensAt = Date.now() + 1500;
    return { state: demo.state, position: 1, opensAt: demo.opensAt, serverNow: Date.now() };
  }
  if (path === '/queue') {
    if (demo.state === 'waiting' && Date.now() >= demo.opensAt) {
      demo.state = 'admitted'; demo.permitUntil = Date.now() + 120000;
    }
    return { state: demo.state, position: demo.state === 'waiting' ? 1 : null,
      opensAt: demo.opensAt, permitUntil: demo.permitUntil, serverNow: Date.now() };
  }
  if (path === '/queue/leave' && method === 'POST') {
    if (demo.hold?.state === 'held') demo.hold.state = 'released';
    if (demo.state !== 'completed') demo.state = 'left';
    return { state: demo.state };
  }
  if (url.pathname === '/seats') {
    if (demo.state !== 'admitted') demoError('QUEUE_REQUIRED', 'ต้องได้รับสิทธิ์จากคิวก่อน');
    const show = url.searchParams.get('show'), zone = url.searchParams.get('zone');
    return { show, zone, serverNow: Date.now(), seats: demoSeats(show, zone) };
  }
  if (path === '/holds' && method === 'POST') {
    const inventory = demoSeats(data.show, data.zone);
    if (data.seats.some(id => inventory.find(seat => seat.id === id)?.state !== 'available')) {
      demoError('SEAT_TAKEN', 'มีที่นั่งไม่ว่างในกลุ่มนี้');
    }
    demo.hold = { id: crypto.randomUUID(), show: data.show, zone: data.zone,
      seats: [...data.seats], state: 'held', expiresAt: Date.now() + 45000,
      total: (['LA2', 'RA2'].includes(data.zone) ? 3200 : 2600) * data.seats.length, simulation: true };
    return { ...demo.hold };
  }
  const holdMatch = /^\/holds\/([^/]+)(?:\/(release|confirm))?$/.exec(url.pathname);
  if (holdMatch && demo.hold?.id === holdMatch[1]) {
    expireDemoHold();
    if (!holdMatch[2] && method === 'GET') return { ...demo.hold };
    if (holdMatch[2] === 'release' && method === 'POST') {
      if (demo.hold.state === 'held') demo.hold.state = 'released';
      return { ...demo.hold };
    }
    if (holdMatch[2] === 'confirm' && method === 'POST') {
      if (demo.hold.state !== 'held') demoError('HOLD_EXPIRED', 'การล็อกหมดอายุแล้ว');
      for (const id of demo.hold.seats) demo.booked.add(`${demo.hold.show}/${demo.hold.zone}/${id}`);
      demo.hold.state = 'confirmed'; demo.state = 'completed';
      return { id: `PAGES-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        show: demo.hold.show, zone: demo.hold.zone, seats: [...demo.hold.seats],
        total: demo.hold.total, simulation: true, payment: 'simulated-no-charge' };
    }
  }
  demoError('NOT_FOUND', 'ไม่พบคำสั่งทดสอบนี้');
}
async function api(path, method = 'GET', data = undefined) {
  if (pagesDemo) {
    const result = await demoApi(path, method, data);
    if (method === 'POST') log(`DEMO ${method} ${path}`);
    return result;
  }
  const response = await fetch(`/api${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(data || {}) } : {}),
    signal: AbortSignal.timeout(8000)
  });
  const result = await response.json();
  if (method === 'POST' || !response.ok) log(`${response.status} ${method} /api${path}`);
  if (!response.ok) { const error = new Error(result.message || 'คำขอไม่สำเร็จ'); error.code = result.error; throw error; }
  if (result.serverNow) serverOffset = result.serverNow - Date.now();
  return result;
}
function setView(view, state) {
  current = view;
  for (const id of ['welcome', 'queue', 'seating', 'holding', 'complete']) $(id).hidden = id !== view;
  for (const [id, match] of [['queue','queue'], ['seats','seating'], ['hold','holding'], ['order','complete']]) {
    $(`step-${id}`).classList.toggle('active', view === match);
  }
  if (state) $('state').textContent = state;
}
function controls() {
  for (const el of $('form').querySelectorAll('select')) el.disabled = active || busy;
  $('start').disabled = !token || active || busy || current === 'complete';
  $('stop').disabled = !active || busy;
  $('reset').disabled = active || busy || !token;
  $('confirm').disabled = busy;
  $('release').disabled = busy;
  $('map-zone').disabled = busy || config?.mode === 'bot';
  for (const button of $('seats').querySelectorAll('button')) {
    button.disabled = button.dataset.state !== 'available' || busy || config?.mode !== 'manual';
  }
  $('hold').disabled = busy || selected.length !== config?.quantity;
}
function fail(error) {
  message(error.name === 'TimeoutError' ? 'เซิร์ฟเวอร์ตอบช้า ลองตรวจสถานะหรือกดใหม่ หากคำขอเดิมสำเร็จ การยืนยันซ้ำจะไม่สร้างรายการซ้ำ' : error.message);
}
function details(id, rows) {
  $(id).replaceChildren(...rows.map(([name, value]) => {
    const row = document.createElement('div'), label = document.createElement('span'), content = document.createElement('strong');
    label.textContent = name; content.textContent = value; row.append(label, content); return row;
  }));
}
function renderSeats() {
  $('seats').replaceChildren();
  for (const row of 'ABCD') {
    const label = document.createElement('span'); label.className = 'row'; label.textContent = row; $('seats').append(label);
    for (const seat of inventory.filter(s => s.row === row)) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `seat ${seat.state}${selected.includes(seat.id) ? ' picked' : ''}${seat.mine ? ' mine' : ''}`;
      button.textContent = seat.number;
      button.dataset.state = seat.state;
      button.disabled = seat.state !== 'available' || busy || config?.mode !== 'manual';
      button.setAttribute('aria-label', `${seat.id} ${seat.state}`);
      button.setAttribute('aria-pressed', String(selected.includes(seat.id)));
      button.addEventListener('click', () => {
        message();
        if (selected.includes(seat.id)) selected = selected.filter(s => s !== seat.id);
        else if (selected.length < config.quantity) selected.push(seat.id);
        else message(`เลือกครบ ${config.quantity} ที่แล้ว กดที่เดิมเพื่อยกเลิก`);
        renderSeats();
      });
      $('seats').append(button);
    }
  }
  $('selected').textContent = selected.length ? `${viewZone} / ${selected.join(', ')}` : 'เลือกที่นั่งแถวเดียวกันและติดกัน';
  $('hold').hidden = config?.mode !== 'manual';
  $('hold').disabled = busy || selected.length !== config?.quantity;
}
async function loadSeats(zone = viewZone) {
  const data = await api(`/seats?show=${config.show}&zone=${zone}`);
  const changed = zone !== viewZone || JSON.stringify(data.seats) !== JSON.stringify(inventory);
  inventory = data.seats; viewZone = zone; $('map-zone').value = zone;
  const oldSelected = selected.join(',');
  selected = selected.filter(id => inventory.some(s => s.id === id && s.state === 'available'));
  if (changed || selected.join(',') !== oldSelected || !$('seats').children.length) renderSeats();
  return data.seats;
}
function findAdjacent(seats, quantity) {
  for (const row of 'ABCD') {
    const free = seats.filter(s => s.row === row && s.state === 'available').sort((a,b) => a.number-b.number);
    for (let i = 0; i <= free.length - quantity; i++) {
      const group = free.slice(i, i + quantity);
      if (group.every((s,j) => s.number === group[0].number + j)) return group.map(s => s.id);
    }
  }
  return null;
}
function displayHold(value) {
  hold = value; selected = [];
  details('hold-detail', [['รอบ', config.show], ['โซน / ที่นั่ง', `${hold.zone} / ${hold.seats.join(', ')}`],
    ['จำนวน', `${hold.seats.length} ใบ`], ['ยอดทดสอบ', `${money(hold.total)} · ไม่เรียกเก็บ`]]);
  setView('holding', 'ล็อกโดยเซิร์ฟเวอร์แล้ว');
  log(`ล็อก ${hold.zone} / ${hold.seats.join(', ')} · รอผู้ใช้ยืนยัน`);
}
async function createHold(zone, seats, expectedRun) {
  const value = await api('/holds', 'POST', { show: config.show, zone, seats, adjacent: true });
  if (run !== expectedRun || !active) {
    await api(`/holds/${value.id}/release`, 'POST'); return;
  }
  displayHold(value);
}
async function runBot(expectedRun) {
  botAttempted = true; $('retry').hidden = true; busy = true; controls();
  try {
    // A bounded search of the user's two configured zones; no purchase waves.
    for (const zone of [...new Set([config.primary, config.backup])]) {
      if (run !== expectedRun || !active) return;
      selected = [];
      const seats = await loadSeats(zone);
      const group = findAdjacent(seats, config.quantity);
      if (!group) { log(`${zone}: ไม่พบ ${config.quantity} ที่ติดกัน → ตรวจตัวเลือกถัดไป`); continue; }
      try { await createHold(zone, group, expectedRun); return; }
      catch (error) {
        if (error.code === 'SEAT_TAKEN') { log(`${zone}: ถูกจองตัดหน้าระหว่างอ่านผังกับล็อก → ตรวจโซนสำรอง`); continue; }
        throw error;
      }
    }
    message('ไม่พบกลุ่มที่นั่งตามเงื่อนไข ผู้ช่วยหยุดค้นหาแล้ว คุณกดค้นใหม่หรือออกจากคิวได้');
    $('retry').hidden = false;
  } catch (error) { fail(error); $('retry').hidden = false; }
  finally { busy = false; controls(); }
}
async function tick() {
  if (!active || busy) return;
  busy = true; controls(); const expectedRun = run;
  let shouldRunBot = false;
  try {
    const status = await api('/queue');
    if (run !== expectedRun) return;
    networkFailures = 0; $('connection').textContent = 'เซิร์ฟเวอร์เชื่อมต่อแล้ว';
    permitUntil = status.permitUntil;
    if (status.state === 'waiting') {
      setView('queue', 'กำลังรอคิว'); $('position').textContent = status.position;
      const wait = Math.ceil((status.opensAt-clock())/1000);
      $('queue-note').textContent = wait > 0 ? `เปิดสิทธิ์ทดสอบใน ${wait} วินาที` : 'รอผู้ซื้อก่อนหน้าจบรายการหรือออกจากคิว';
    } else if (status.state === 'admitted') {
      if (hold) {
        const value = await api(`/holds/${hold.id}`);
        if (value.state !== 'held') {
          log(`ล็อก ${value.state} · กลับหน้าเลือกที่นั่ง`); hold = null; selected = []; botAttempted = true;
          message('การล็อกหมดอายุแล้ว ระบบคืนที่นั่งให้คนอื่นเลือกได้');
          setView('seating', 'การล็อกหมดอายุ'); await loadSeats();
          $('retry').hidden = config.mode !== 'bot';
        }
      } else {
        if (current !== 'seating') { setView('seating', 'ได้รับสิทธิ์แล้ว'); log('เซิร์ฟเวอร์อนุญาตผ่านคิวแล้ว'); }
        if (config.mode === 'manual') await loadSeats();
        else if (!botAttempted) shouldRunBot = true;
      }
    } else if (status.state === 'expired') {
      active = false; hold = null; selected = [];
      setView('welcome', 'สิทธิ์เข้าซื้อหมดอายุ'); message('สิทธิ์เข้าซื้อหมดเวลา กดเริ่มเพื่อเข้าต่อท้ายคิวใหม่');
      log('สิทธิ์เข้าซื้อหมดอายุ');
    } else if (status.state === 'completed') {
      active = false; log('เซสชันนี้มีรายการสำเร็จแล้ว เริ่มผู้ซื้อคนใหม่เพื่อทดลองต่อ');
      if (current !== 'complete') { setView('welcome', 'รายการเสร็จแล้ว'); message('เซสชันนี้จบรายการแล้ว กดเริ่มใหม่ด้วยผู้ซื้อคนใหม่'); }
    } else {
      active = false; hold = null; setView('welcome', 'ออกจากคิวแล้ว');
    }
  } catch (error) {
    fail(error); networkFailures++; $('connection').textContent = 'เชื่อมต่อขัดข้อง';
    if (error.code === 'SESSION_REQUIRED' || networkFailures >= 3) {
      active = false; log('หยุดผู้ช่วยหลังเชื่อมต่อขัดข้อง กรุณาตรวจเซิร์ฟเวอร์แล้วเริ่มใหม่');
    }
  } finally { busy = false; controls(); }
  if (shouldRunBot && run === expectedRun && active) await runBot(expectedRun);
}
$('form').addEventListener('submit', async e => {
  e.preventDefault(); if (active || busy) return; message();
  config = { mode: $('mode').value, show: $('show').value, quantity: +$('quantity').value,
    primary: $('primary').value, backup: $('backup').value };
  if (config.primary === config.backup) return message('เลือกโซนสำรองให้ต่างจากโซนหลัก');
  active = true; busy = true; const expectedRun = ++run; botAttempted = false; hold = null; selected = [];
  viewZone = config.primary; $('map-zone').value = viewZone; $('map-zone').disabled = config.mode === 'bot';
  $('retry').hidden = true; controls();
  try { await api('/queue/join', 'POST'); setView('queue', 'เข้าคิวแล้ว'); }
  catch (error) { active = false; fail(error); }
  finally { busy = false; controls(); }
  if (run === expectedRun && active) await tick();
});
$('stop').addEventListener('click', async () => {
  if (busy) return; busy = true; controls();
  try {
    await api('/queue/leave', 'POST'); active = false; run++; hold = null; selected = [];
    setView('welcome', 'ออกจากคิวแล้ว'); message(); log('ปล่อยที่นั่งและสิทธิ์คิวแล้ว');
  } catch (error) { fail(error); }
  finally { busy = false; controls(); }
});
$('map-zone').addEventListener('change', async () => {
  if (busy) { $('map-zone').value = viewZone; return; }
  busy = true; controls(); selected = []; message();
  try { await loadSeats($('map-zone').value); } catch (error) { fail(error); }
  finally { busy = false; controls(); renderSeats(); }
});
$('hold').addEventListener('click', async () => {
  if (busy || selected.length !== config.quantity) return;
  busy = true; controls(); message();
  try { await createHold(viewZone, [...selected], run); }
  catch (error) { fail(error); await loadSeats().catch(() => {}); }
  finally { busy = false; controls(); }
});
$('confirm').addEventListener('click', async () => {
  if (busy || !hold) return;
  busy = true; controls(); message();
  try {
    const order = await api(`/holds/${hold.id}/confirm`, 'POST');
    active = false; run++; hold = null;
    details('order-detail', [['รหัสทดสอบ', order.id], ['รอบ / โซน', `${order.show} / ${order.zone}`],
      ['ที่นั่ง', order.seats.join(', ')], ['ยอดทดสอบ', `${money(order.total)} · ไม่เรียกเก็บ`], ['การชำระเงิน', 'จำลองเท่านั้น']]);
    setView('complete', 'จองทดสอบสำเร็จ'); log(`เซิร์ฟเวอร์สร้าง ${order.id} · ที่นั่งเปลี่ยนเป็น booked`);
  } catch (error) { fail(error); }
  finally { busy = false; controls(); }
});
$('release').addEventListener('click', async () => {
  if (busy || !hold) return; busy = true; controls();
  try {
    await api(`/holds/${hold.id}/release`, 'POST'); hold = null; selected = []; botAttempted = true;
    setView('seating', 'ปล่อยที่นั่งแล้ว'); await loadSeats(); $('retry').hidden = config.mode !== 'bot';
  } catch (error) { fail(error); }
  finally { busy = false; controls(); renderSeats(); }
});
$('retry').addEventListener('click', async () => { if (!busy && active) { message(); await runBot(run); } });
$('other').addEventListener('click', () => window.open(location.href, '_blank', 'noopener,noreferrer'));
async function freshSession() {
  if (active || busy) return; busy = true; controls(); message();
  try {
    const data = await api('/session', 'POST'); token = data.token; buyer = data.buyer;
    sessionStorage.setItem('ticket-lab-token', token); sessionStorage.setItem('ticket-lab-buyer', buyer);
    $('buyer').textContent = buyer; hold = null; selected = []; current = 'idle';
    setView('welcome', 'พร้อมเริ่ม'); log(`ผู้ซื้อทดสอบใหม่ ${buyer}`);
  } catch (error) { fail(error); }
  finally { busy = false; controls(); }
}
$('reset').addEventListener('click', freshSession); $('again').addEventListener('click', freshSession);
$('extension-preview').addEventListener('click', () => {
  if (pagesDemo) return message('ตัวอย่างส่วนขยายใช้ได้เมื่อรัน Node.js บนเครื่อง ส่วนหน้า GitHub Pages นี้สาธิตลำดับคิวและการเลือกที่นั่ง');
  const existing = document.getElementById('ticket-pilot-extension');
  if (existing) { existing.dispatchEvent(new Event('pilot-open')); return; }
  if (document.getElementById('pilot-preview-script')) return;
  const script = document.createElement('script'); script.id = 'pilot-preview-script'; script.src = './pilot-panel.js';
  script.addEventListener('error', () => { script.remove(); message('โหลดตัวอย่างไม่ได้ ตรวจว่าเซิร์ฟเวอร์เป็นเวอร์ชันล่าสุดแล้วลองใหม่'); });
  document.body.append(script);
});
setInterval(() => {
  if (active) {
    $('permit-time').textContent = `${Math.max(0, Math.ceil((permitUntil-clock())/1000))} วิ`;
    if (hold) $('hold-time').textContent = Math.max(0, Math.ceil((hold.expiresAt-clock())/1000));
  }
}, 250);
setInterval(tick, 1000);
try {
  event = await api('/event'); $('connection').textContent = pagesDemo ? 'โหมดสาธิตบน GitHub Pages' : 'เซิร์ฟเวอร์เชื่อมต่อแล้ว';
  if (token && buyer) {
    $('buyer').textContent = buyer;
    // A reload starts a clean UI: explicitly release any old hold/queue first.
    await api('/queue/leave', 'POST').catch(() => {});
  }
  await freshSession(); log(`พร้อมใช้งาน · คิว ${event.capacity} ช่อง · ล็อก ${event.holdSeconds} วินาที`);
} catch (error) { fail(error); $('connection').textContent = 'เชื่อมต่อไม่ได้'; }
