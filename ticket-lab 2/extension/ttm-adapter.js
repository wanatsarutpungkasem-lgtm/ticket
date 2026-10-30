// Serialized into the active tab by Chrome. No dependency on this module's scope.
// Only a visible round <select> can change, upon an explicit user action.
export function ttmPageAction(action = { kind: 'inspect' }) {
  const url = new URL(location.href);
  const official = url.protocol === 'https:' && url.hostname === 'booking.thaiticketmajor.com' &&
    url.port === '' && url.pathname === '/booking/3m/zones.php';
  const fixture = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) &&
    url.port === '5208' && url.pathname === '/ttm-fixture';
  const error = (code, message) => ({ ok: false, code, message });
  if (!official && !fixture) return error('UNSUPPORTED_PAGE', 'เปิดหน้าเลือกรอบและโซน TTM ก่อน รุ่นนี้ไม่ทำงานบนหน้าคิว เลือกที่นั่ง หรือชำระเงิน');
  if (!['inspect','select-round'].includes(action.kind)) return error('UNSUPPORTED_ACTION', 'รุ่นนี้ตรวจข้อมูลและเลือกรอบตามที่คุณกดเท่านั้น');
  const visible = el => Boolean(el && !el.hidden && el.getClientRects().length &&
    getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none');
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const nodes = selector => [...document.querySelectorAll(selector)].filter(el => !el.closest('[data-pilot-ui]') && visible(el));
  if (fixture && !document.querySelector('meta[name="ticket-pilot-fixture"][content="true"]')) {
    return error('FIXTURE_MISSING', 'ไม่พบเครื่องหมายหน้าอ้างอิงทดสอบ');
  }
  if (nodes('input[type="password"]').length) return error('LOGIN_REQUIRED', 'พบหน้าล็อกอิน ให้คุณเข้าสู่ระบบเองก่อน');
  if (nodes('h1,h2,[role="alert"]').some(el => /(?:waiting room|queue|รอคิว|รับคิว|captcha|ยืนยันว่าคุณไม่ใช่)/i.test(clean(el.textContent))) ||
    nodes('iframe[title*="captcha" i],iframe[title*="challenge" i]').length) {
    return error('WAIT_FOR_USER', 'พบการรอคิวหรือยืนยันตัวตน ให้ดำเนินการตามเว็บไซต์ก่อน');
  }
  const event = nodes('h1').map(el => clean(el.textContent)).find(text => text && !/^(?:ขั้นตอน|โซนที่นั่ง|เลือกรอบ|ตรวจหน้า)/.test(text));
  if (!event) return error('EVENT_NOT_FOUND', 'ไม่พบชื่องาน จึงหยุดโดยไม่เปลี่ยนค่า');
  const candidates = nodes('select').filter(el => [...el.options].some(o =>
    /(?:เลือกรอบการแสดง|Show date|\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b.*20\d{2})/i.test(clean(o.textContent))));
  if (candidates.length !== 1) return error('ROUND_AMBIGUOUS', 'ไม่พบช่องรอบที่ชัดเจนเพียงช่องเดียว รุ่นนี้จะไม่เดา');
  const select = candidates[0];
  const rounds = [...select.options].map((option, index) => ({ index, label: clean(option.textContent),
    selected: option.selected, disabled: option.disabled || select.disabled || Boolean(option.closest('optgroup')?.disabled),
    placeholder: /^(?:เลือกรอบ|select|choose)/i.test(clean(option.textContent)) }));
  const revision = JSON.stringify({ event, rounds: rounds.map(({ label, disabled, placeholder }) => ({ label, disabled, placeholder })) });
  const zones = [];
  for (const table of nodes('table')) {
    const rows = [...table.querySelectorAll('tr')].filter(visible);
    const headers = rows[0] ? [...rows[0].querySelectorAll('th,td')].map(el => clean(el.textContent)) : [];
    if (!/โซนที่นั่ง|zone/i.test(headers[0] || '') || !/ที่นั่งว่าง|available/i.test(headers[1] || '')) continue;
    for (const row of rows.slice(1, 81)) {
      const cells = [...row.querySelectorAll('td')].filter(visible);
      if (cells.length >= 2) zones.push({ zone: clean(cells[0].textContent), availability: clean(cells[1].textContent) });
    }
  }
  const report = { ok: true, source: fixture ? 'fixture' : 'ttm', event,
    page: `${url.origin}${url.pathname}`, // No URL query, cookies, fields, tokens or user profiles.
    stage: nodes('h2').map(el => clean(el.textContent)).find(text => /ขั้นตอน/.test(text)) || 'หน้าเลือกรอบและโซน',
    rounds, revision, zones, inventoryRead: zones.length > 0, changed: false, quantitySupported: false };
  if (action.kind === 'inspect') return report;
  if (action.revision !== revision) return error('PAGE_CHANGED', 'ชื่องานหรือรอบเปลี่ยนไป กดตรวจหน้าใหม่ก่อน');
  const choice = rounds.find(round => round.index === action.index && round.label === action.label);
  if (!choice || choice.disabled || choice.placeholder) return error('INVALID_ROUND', 'รอบนี้เลือกไม่ได้ กรุณาตรวจหน้าใหม่');
  if (select.selectedIndex === choice.index) return { ...report, message: 'เว็บเลือกรอบนี้อยู่แล้ว ไม่ส่งเหตุการณ์ซ้ำ' };
  select.selectedIndex = choice.index;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return { ...report, changed: true, message: 'เลือกรอบแล้ว เว็บอาจเปลี่ยนหน้า ให้กดตรวจใหม่ ยังไม่ได้จองบัตร' };
}
