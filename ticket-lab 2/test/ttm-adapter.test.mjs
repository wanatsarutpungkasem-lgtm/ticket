import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { ttmPageAction } from '../extension/ttm-adapter.js';

function page({ href = 'https://booking.thaiticketmajor.com/booking/3m/zones.php?query=805&tk=PRIVATE_TOKEN',
  eventName = 'Moonshadow — Rerun', duplicate = false, login = false, queue = false, hidden = false } = {}) {
  let changes = 0;
  const el = (textContent, extra = {}) => ({ textContent, hidden: false, closest: () => null,
    getClientRects: () => [1], querySelectorAll: () => [], ...extra });
  const rounds = [el('เลือกรอบการแสดง', { selected:true }), el('Wed 28 Oct 2026 10:01 (Show date 14/10/26 FAN PARTY)'),
    el('Wed 28 Oct 2026 10:02 (Show date 15/10/26 AFTER PARTY)'), el('Wed 28 Oct 2026 10:03 CLOSED', { disabled:true })];
  const select = el('', { hidden, options: rounds, selectedIndex: 0, disabled:false,
    dispatchEvent: event => { assert.equal(event.type, 'change'); changes++; } });
  const row = (a,b,header = false) => el('', { querySelectorAll: selector => selector === 'td' && header ? [] : [el(a),el(b)] });
  const table = el('', { querySelectorAll: () => [row('โซนที่นั่ง','ที่นั่งว่าง',true), row('RERUN E-TICKET','Available')] });
  const h1 = el(eventName), h2 = el('ขั้นตอนที่ 1/4 เลือกรอบ & โซนการแสดง');
  const doc = { querySelector: () => null, querySelectorAll(selector) {
    if (selector === 'input[type="password"]') return login ? [el('')] : [];
    if (selector === 'h1,h2,[role="alert"]') return queue ? [el('Waiting room / รอคิว')] : [h1,h2];
    if (selector === 'h1') return [h1]; if (selector === 'h2') return [h2];
    if (selector === 'select') return duplicate ? [select,select] : [select];
    if (selector === 'table') return [table]; return [];
  } };
  Object.defineProperty(doc, 'cookie', { get() { throw new Error('must not read cookies'); } });
  const context = { URL, location:{href}, document:doc,
    getComputedStyle: () => ({ visibility:'visible', display:'block' }), Event: class { constructor(type) { this.type=type; } },
    fetch() { throw new Error('must not send network requests'); } };
  const run = action => JSON.parse(JSON.stringify(vm.runInNewContext(`(${ttmPageAction.toString()})(${JSON.stringify(action)})`,context)));
  return { run, select, get changes() { return changes; } };
}
test('TTM reader returns event, rounds and visible availability without changing the page or exposing URL tokens', () => {
  const fixture = page(), result = fixture.run({kind:'inspect'});
  assert.equal(result.ok,true); assert.equal(result.source,'ttm'); assert.equal(result.quantitySupported,false);
  assert.equal(result.event,'Moonshadow — Rerun'); assert.equal(result.rounds.length,4);
  assert.deepEqual(result.zones,[{zone:'RERUN E-TICKET',availability:'Available'}]);
  assert.equal(fixture.changes,0); assert.equal(fixture.select.selectedIndex,0);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TOKEN|\?query|tk=/);
});
test('round selection requires the inspected snapshot, exact label, valid index and one explicit action', () => {
  const fixture = page(), report = fixture.run({kind:'inspect'}), choice = report.rounds[1];
  assert.equal(fixture.run({kind:'select-round',index:1,label:choice.label,revision:'old'}).code,'PAGE_CHANGED');
  assert.equal(fixture.changes,0);
  const result=fixture.run({kind:'select-round',index:1,label:choice.label,revision:report.revision});
  assert.equal(result.changed,true); assert.equal(fixture.select.selectedIndex,1); assert.equal(fixture.changes,1);
  assert.equal(fixture.run({kind:'select-round',index:1,label:choice.label,revision:report.revision}).changed,false);
  assert.equal(fixture.changes,1);
});
test('placeholder, disabled, renamed, out-of-range and unsupported operations cannot mutate controls', () => {
  const fixture = page(), report = fixture.run({kind:'inspect'});
  for(const [index,label] of [[0,report.rounds[0].label],[3,report.rounds[3].label],[1,'wrong'],[99,'none']]) {
    assert.equal(fixture.run({kind:'select-round',index,label,revision:report.revision}).code,'INVALID_ROUND');
  }
  assert.equal(fixture.run({kind:'checkout'}).code,'UNSUPPORTED_ACTION'); assert.equal(fixture.changes,0);
});
test('unsupported hosts, insecure transport and purchase/queue pages are rejected', () => {
  for(const href of ['https://booking.thaiticketmajor.com.evil.example/booking/3m/zones.php',
    'http://booking.thaiticketmajor.com/booking/3m/zones.php','https://www.thaiticketmajor.com/booking/3m/zones.php',
    'https://booking.thaiticketmajor.com/booking/3m/checkout.php','https://booking.thaiticketmajor.com/queue',
    'https://booking.thaiticketmajor.com:8443/booking/3m/zones.php']) {
    const fixture = page({href}); assert.equal(fixture.run({kind:'inspect'}).code,'UNSUPPORTED_PAGE'); assert.equal(fixture.changes,0);
  }
});
test('login and queue challenges stop the adapter before round selection', () => {
  for(const config of [{login:true},{queue:true}]) {
    const fixture = page(config), result = fixture.run({kind:'inspect'});
    assert.equal(result.ok,false); assert.match(result.code,/LOGIN_REQUIRED|WAIT_FOR_USER/); assert.equal(fixture.changes,0);
  }
});
test('ambiguous or hidden controls fail closed', () => {
  for(const config of [{duplicate:true},{hidden:true}]) {
    const fixture = page(config); assert.equal(fixture.run({kind:'inspect'}).code,'ROUND_AMBIGUOUS'); assert.equal(fixture.changes,0);
  }
});
test('changed event invalidates previously inspected selections', () => {
  const a = page(), report = a.run({kind:'inspect'}), b=page({eventName:'Different event'});
  assert.equal(b.run({kind:'select-round',index:1,label:report.rounds[1].label,revision:report.revision}).code,'PAGE_CHANGED');
  assert.equal(b.changes,0);
});
test('localhost fixture cannot masquerade as the real TTM page without its marker', () => {
  assert.equal(page({href:'http://127.0.0.1:5208/ttm-fixture'}).run({kind:'inspect'}).code,'FIXTURE_MISSING');
});
