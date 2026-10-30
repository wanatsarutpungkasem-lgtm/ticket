// Browser extension and in-page preview share this exact DOM-only controller.
// No credentials, no API interception, no external domains or target URL input.
(() => {
  'use strict';
  if (!['localhost', '127.0.0.1'].includes(location.hostname) || location.port !== '5208' ||
      !document.title.startsWith('Ticket Pilot Lab') || !document.getElementById('form')) return;
  const existing = document.getElementById('ticket-pilot-extension');
  if (existing) { existing.dispatchEvent(new Event('pilot-open')); return; }
  const host = document.createElement('div'); host.id = 'ticket-pilot-extension';
  const shadow = host.attachShadow({ mode: 'open' });
  // The stylesheet is supplied by our lab's same-origin server.
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = '/pilot-panel.css';
  shadow.append(stylesheet);
  const content = document.createElement('div');
  content.innerHTML = `
    <section class="panel" id="panel" aria-label="ผู้ช่วย Ticket Pilot">
      <div class="top"><span class="eyebrow">TICKET PILOT / EXTENSION</span><button class="close" id="close" aria-label="ย่อแผงผู้ช่วย">×</button></div>
      <h2>ผู้ช่วยอยู่ข้างหน้าเว็บ</h2><span class="badge">LOCAL LAB ONLY</span>
      <p>แผงนี้ช่วยกดปุ่มบนเว็บทดสอบ เหมือนคุณคลิกเอง คิวและสิทธิ์ยังตัดสินโดยเซิร์ฟเวอร์</p>
      <label>รอบทดสอบ<select id="show"><option value="A">รอบ A · 19:00</option><option value="B">รอบ B · 19:00</option></select></label>
      <div class="two"><label>จำนวน<select id="quantity"><option value="2">2 ใบ</option><option value="1">1 ใบ</option><option value="3">3 ใบ</option><option value="4">4 ใบ</option></select></label><label>โซนหลัก<select id="primary"><option>LA2</option><option>RA2</option><option>LB2</option><option>RB2</option></select></label></div>
      <label>โซนสำรอง<select id="backup"><option>RA2</option><option>LA2</option><option>LB2</option><option>RB2</option></select></label>
      <button class="primary" id="start">▶ ให้ผู้ช่วยเข้าคิวและเลือกที่</button>
      <button class="secondary" id="stop" disabled>■ หยุดและปล่อยสิทธิ์</button>
      <button class="secondary" id="review" hidden>ดูรายการที่ล็อก แล้วกดยืนยันเอง →</button>
      <div class="steps"><span id="s-queue">เข้าคิว</span><span id="s-seats">เลือกที่</span><span id="s-hold">ล็อกแล้ว</span></div>
      <div class="status" id="status" role="status" aria-live="polite">พร้อมเริ่ม · ใช้รหัสผู้ซื้อทดสอบของหน้าเว็บนี้</div>
      <div class="trace" id="trace"></div>
      <div class="note">ไม่กดยืนยันรายการ ไม่กรอกเลขบัตรประชาชน ไม่มีการส่งข้อมูลไปเว็บภายนอก<br>ปิดแผงคือย่อหน้าต่าง หากต้องการยกเลิกให้กดปุ่มหยุด</div>
    </section><button class="launcher" id="toggle">◈ ผู้ช่วย</button>`;
  shadow.append(content); document.body.append(host);
  const $ = id => shadow.getElementById(id), page = id => document.getElementById(id);
  let running = false, stopping = false, generation = 0, settings = null;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => Boolean(el && !el.hidden && el.getClientRects().length);
  function text(value) { $('status').textContent = value; }
  function log(value) {
    const line = new Date().toLocaleTimeString('th-TH') + ' ' + value;
    $('trace').textContent = [...$('trace').textContent.split('\n').filter(Boolean).slice(-19), line].join('\n');
    $('trace').scrollTop = $('trace').scrollHeight;
  }
  function step(value) { for (const id of ['queue', 'seats', 'hold']) $('s-' + id).classList.toggle('active', id === value); }
  function controls() {
    $('start').disabled = running || stopping || Boolean(page('start')?.disabled) || visible(page('holding'));
    $('stop').disabled = (!running && !visible(page('holding'))) || stopping;
    for (const el of shadow.querySelectorAll('select')) el.disabled = running || stopping;
  }
  function pick(id, value) {
    const el = page(id);
    if (!el || el.disabled || ![...el.options].some(o => o.value === value)) throw new Error('ช่องตั้งค่าของเว็บยังไม่พร้อม: ' + id);
    el.value = value; el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function waitFor(check, g, timeout = 12000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (!running || g !== generation) throw new Error('หยุดการทำงานแล้ว');
      if (check()) return;
      await pause(200);
    }
    throw new Error('หน้าเว็บยังไม่พร้อม ผู้ช่วยหยุดให้ตรวจสอบ');
  }
  function pairFromDOM() {
    const seats = [...(page('seats')?.querySelectorAll('button') || [])].map(button => {
      const match = /^([A-D])(10|[1-9]) available$/.exec(button.getAttribute('aria-label') || '');
      return match && !button.disabled ? { button, row: match[1], n: +match[2] } : null;
    }).filter(Boolean);
    for (const row of 'ABCD') {
      const free = seats.filter(s => s.row === row).sort((a,b) => a.n-b.n);
      for (let i = 0; i <= free.length - settings.quantity; i++) {
        const group = free.slice(i, i + settings.quantity);
        if (group.every((s,j) => s.n === group[0].n + j)) return group;
      }
    }
    return null;
  }
  async function releaseThroughPage() {
    const end = Date.now() + 12000;
    // Keep waiting for the lab's in-flight operation so we do not leave a late hold.
    while (Date.now() < end) {
      const stop = page('stop');
      if (stop && !stop.disabled) {
        stop.click();
        const waitEnd = Date.now() + 8500;
        while (Date.now() < waitEnd) {
          if (visible(page('welcome')) && !page('start')?.disabled) return true;
          await pause(200);
        }
        return false;
      }
      if (visible(page('complete')) || (visible(page('welcome')) && !page('start')?.disabled)) return true;
      await pause(200);
    }
    return false;
  }
  $('start').addEventListener('click', async () => {
    if (running || stopping) return;
    if (!page('start') || page('start').disabled) return text('หน้าเว็บมีรายการหรือคิวค้างอยู่ ให้จบรายการหรือเริ่มผู้ซื้อคนใหม่ก่อน');
    settings = { show: $('show').value, quantity: +$('quantity').value, primary: $('primary').value, backup: $('backup').value };
    if (settings.primary === settings.backup) return text('เลือกโซนสำรองให้ต่างจากโซนหลัก');
    running = true; controls(); $('review').hidden = true; $('trace').textContent = ''; const g = ++generation;
    try {
      // Use the manual mode so this extension, rather than the page's bot, clicks seats.
      for (const [id, value] of [['mode','manual'], ['show',settings.show], ['quantity',String(settings.quantity)],
        ['primary',settings.primary], ['backup',settings.backup]]) pick(id, value);
      page('start').click(); step('queue'); log('กดเริ่มบนหน้าเว็บ · รอคิวตามปกติ'); text('กำลังรอให้เซิร์ฟเวอร์อนุญาตผ่านคิว');
      await waitFor(() => visible(page('seating')), g, 180000);
      step('seats'); log('หน้าเลือกที่นั่งเปิดแล้ว');
      for (const zone of [settings.primary, settings.backup]) {
        await waitFor(() => page('map-zone') && !page('map-zone').disabled, g);
        // The page clears selection and fetches the selected zone on this DOM event.
        pick('map-zone', zone); await pause(250);
        await waitFor(() => !page('map-zone').disabled && page('map-zone').value === zone && page('seats')?.children.length > 0, g);
        if (visible(page('message')) && page('message').textContent) throw new Error(page('message').textContent);
        const group = pairFromDOM();
        if (!group) { log(zone + ' ไม่มีที่ติดกันตามจำนวน · ตรวจโซนถัดไป'); continue; }
        const ids = group.map(s => s.row + s.n); text('เลือก ' + zone + ' / ' + ids.join(', ')); log('คลิกที่นั่ง ' + zone + ' / ' + ids.join(', '));
        // Each click re-renders the page's seat buttons: resolve the next one afresh.
        for (const id of ids) {
          await waitFor(() => [...page('seats').querySelectorAll('button')].some(b => b.getAttribute('aria-label') === id + ' available' && !b.disabled), g);
          const target = [...page('seats').querySelectorAll('button')].find(b => b.getAttribute('aria-label') === id + ' available');
          if (!running || g !== generation) throw new Error('หยุดการทำงานแล้ว');
          target.click();
        }
        await waitFor(() => page('hold') && !page('hold').disabled, g); page('hold').click();
        await waitFor(() => visible(page('holding')) || (visible(page('message')) && Boolean(page('message').textContent)), g);
        if (visible(page('holding'))) {
          step('hold'); log('เว็บแสดงผลล็อกสำเร็จ · ไม่กดยืนยันแทนคุณ');
          text('ล็อก ' + zone + ' / ' + ids.join(', ') + ' แล้ว ตรวจรายละเอียดในเว็บแล้วกดยืนยันเองภายในเวลาที่กำหนด');
          running = false; controls(); $('stop').disabled = false; $('review').hidden = false; return;
        }
        const problem = page('message').textContent;
        log('ล็อกไม่สำเร็จ: ' + problem);
        if (!problem.includes('มีคนล็อกหรือจอง')) throw new Error(problem);
      }
      throw new Error('ไม่พบกลุ่มที่นั่งตามเงื่อนไขในทั้งสองโซน');
    } catch (error) {
      if (g !== generation) return;
      log(error.message); text(error.message);
      running = false; stopping = true; controls();
      const released = await releaseThroughPage();
      if (!released) text(error.message + ' · ตรวจปุ่มออกจากคิวในหน้าเว็บเพื่อปล่อยสิทธิ์');
      stopping = false; controls();
    }
  });
  $('stop').addEventListener('click', async () => {
    if (stopping) return;
    generation++; running = false; stopping = true; controls(); text('กำลังหยุดและปล่อยสิทธิ์ผ่านหน้าเว็บ…');
    const released = await releaseThroughPage();
    text(released ? 'หยุดแล้ว · ปล่อยคิวและที่นั่งแล้ว' : 'หยุดผู้ช่วยแล้ว แต่ยังยืนยันการปล่อยสิทธิ์ไม่ได้ ให้ตรวจหน้าเว็บ');
    log(released ? 'หยุดและปล่อยสิทธิ์สำเร็จ' : 'ต้องตรวจหน้าเว็บต่อ'); stopping = false; step(''); $('review').hidden = true; controls();
  });
  $('review').addEventListener('click', () => {
    $('panel').hidden = true;
    const confirm = page('confirm');
    if (visible(confirm)) { confirm.scrollIntoView({ block: 'center', behavior: 'smooth' }); confirm.focus({ preventScroll: true }); }
  });
  $('close').addEventListener('click', () => { $('panel').hidden = true; });
  $('toggle').addEventListener('click', () => { $('panel').hidden = !$('panel').hidden; controls(); });
  host.addEventListener('pilot-open', () => { $('panel').hidden = false; controls(); });
  const observer = new MutationObserver(controls);
  observer.observe(page('start'), { attributes: true, attributeFilter: ['disabled'] });
  observer.observe(page('holding'), { attributes: true, attributeFilter: ['hidden'] });
  controls();
})();
