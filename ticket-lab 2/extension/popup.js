import { ttmPageAction } from './ttm-adapter.js';
const $ = id => document.getElementById(id);
let report = null, targetTabId = null, busy = false;
const fixture = ['localhost','127.0.0.1'].includes(location.hostname) && location.port === '5208' && location.pathname === '/ttm-fixture';
function status(message) { $('status').textContent = message; }
function controls() {
  $('inspect').disabled = busy;
  $('round-choice').disabled = busy || !report;
  $('apply').disabled = busy || !report || !$('round-choice').value;
}
async function execute(action) {
  if (fixture) return ttmPageAction(action);
  if (!globalThis.chrome?.scripting || !globalThis.chrome?.tabs) throw new Error('เปิดแผงนี้ผ่านไอคอนส่วนขยายใน Chrome');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('เข้าถึงแท็บไม่ได้ คลิกไอคอนส่วนขยายบนแท็บ TTM อีกครั้ง');
  const url = new URL(tab.url);
  if (url.protocol !== 'https:' || url.hostname !== 'booking.thaiticketmajor.com' || url.pathname !== '/booking/3m/zones.php') {
    throw new Error('เปิดแท็บหน้าเลือกรอบและโซนของ TTM ก่อน รุ่นนี้ยังไม่รองรับหน้าอื่น');
  }
  if (action.kind !== 'inspect' && tab.id !== targetTabId) throw new Error('แท็บเปลี่ยนไป กดตรวจหน้าใหม่ก่อน');
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: ttmPageAction, args: [action] });
  if (action.kind === 'inspect') targetTabId = tab.id;
  if (!results[0]?.result) throw new Error('หน้าเว็บเปลี่ยนระหว่างตรวจ กดตรวจใหม่ก่อน');
  return results[0].result;
}
function render(result) {
  report = result; $('report').hidden = false;
  $('source').textContent = result.source === 'ttm' ? 'อ่านจากแท็บ TTM จริง' : 'FIXTURE · หน้าอ้างอิงทดสอบ';
  $('event-name').textContent = result.event; $('page-stage').textContent = result.stage;
  const options = result.rounds.filter(round => !round.placeholder);
  $('round-choice').replaceChildren(...options.map(round => {
    const option = document.createElement('option'); option.value = String(round.index); option.textContent = round.label;
    option.disabled = round.disabled; option.selected = round.selected; return option;
  }));
  if (!options.some(round => !round.disabled)) $('round-choice').value = '';
  $('zones').replaceChildren(...result.zones.map(zone => {
    const item = document.createElement('li'); item.textContent = `${zone.zone}: ${zone.availability}`; return item;
  }));
  $('availability').textContent = result.inventoryRead ? 'ข้อมูลคงเหลือที่เว็บแสดงขณะตรวจ ไม่ใช่ผลการล็อกที่นั่ง' : 'ยังไม่เห็นตารางคงเหลือ ให้เปิด “ที่นั่งว่าง” บนเว็บเอง แล้วกดตรวจใหม่';
}
function resetReport() { report = null; $('report').hidden = true; controls(); }
$('inspect').addEventListener('click', async () => {
  if (busy) return; busy = true; resetReport(); controls(); status('กำลังตรวจเฉพาะชื่องาน รอบ และตารางคงเหลือที่มองเห็น…');
  try {
    const result = await execute({ kind: 'inspect' });
    if (!result.ok) throw new Error(result.message);
    render(result); status('อ่านข้อมูลแล้ว · ยังไม่ได้เปลี่ยนค่า ส่งคำขอจอง หรือชำระเงิน');
  } catch (error) { resetReport(); status(error.message); }
  finally { busy = false; controls(); }
});
$('round-choice').addEventListener('change', controls);
$('apply').addEventListener('click', async () => {
  if (busy || !report) return;
  const index = Number($('round-choice').value), choice = report.rounds.find(round => round.index === index);
  if (!choice) return;
  busy = true; controls();
  try {
    const result = await execute({ kind: 'select-round', index, label: choice.label, revision: report.revision });
    if (!result.ok) throw new Error(result.message);
    status(result.message); if (result.changed) resetReport();
  } catch { resetReport(); status('หน้าเว็บอาจเปลี่ยนหรือการเลือกรอบไม่สำเร็จ กดตรวจหน้าใหม่ก่อนทำต่อ'); }
  finally { busy = false; controls(); }
});
controls();
