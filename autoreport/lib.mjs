/* Чиста логіка автозвітів (без мережі) — щоб її можна було перевірити тестом. */
export const TZ = 'Europe/Kyiv';
const p2 = (n) => String(n).padStart(2, '0');
export const isoOf = (y, m, d) => `${y}-${p2(m + 1)}-${p2(d)}`;

/** Поточні дата/час за Києвом: { date:'YYYY-MM-DD', hm:'HH:MM', dow:1..7 (Пн=1), day, y, m } */
export function kyivNow(now = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
  const o = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const dow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[o.weekday];
  return { date: `${o.year}-${o.month}-${o.day}`, hm: `${o.hour === '24' ? '00' : o.hour}:${o.minute}`, dow, day: +o.day, y: +o.year, m: +o.month - 1 };
}

/** Чи настав час надіслати автозвіт. Надсилаємо раз на добу, коли розклад збігається з сьогоднішнім днем і час уже настав
 *  (затримка запуску GitHub не страшна — наступний запуск доженене). */
export function isDue(a, n) {
  if (!a.active || !(a.recipients || []).length) return false;
  if (a.lastRunDate === n.date) return false;
  if (a.freq === 'weekly' && n.dow !== (a.day || 1)) return false;
  if (a.freq === 'monthly' && n.day !== (a.day || 1)) return false;
  return n.hm >= (a.time || '08:00');
}

/** Період звіту [from, to] за правилом періодичності. */
export function periodOf(freq, n) {
  const d = (y, m, dd) => new Date(Date.UTC(y, m, dd));
  const iso = (x) => isoOf(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const today = d(n.y, n.m, n.day);
  if (freq === 'monthly') { const f = d(n.y, n.m - 1, 1), t = d(n.y, n.m, 0); return [iso(f), iso(t)]; }
  if (freq === 'weekly') { const mon = d(n.y, n.m, n.day - (n.dow - 1) - 7), sun = d(n.y, n.m, n.day - (n.dow - 1) - 1); return [iso(mon), iso(sun)]; }
  const y = new Date(today.getTime() - 864e5); return [iso(y), iso(y)];
}

const MON = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
export const uaDate = (s) => s.split('-').reverse().join('.');
export const periodLabel = (freq, [f, t]) => freq === 'monthly' ? `${MON[+f.slice(5, 7) - 1]} ${f.slice(0, 4)}` : f === t ? uaDate(f) : `${uaDate(f)} – ${uaDate(t)}`;

/** Групи звіту за його ключем (ті самі, що в застосунку). dir: { workers, labels, discounts, institutions, doctors } — Map id→назва */
export function groupKey(report, r, dir) {
  const ref = r.referral || {};
  switch (report) {
    case 'rLab': return dir.workers.get(r.labTechId) || '— без лаборанта —';
    case 'rDoc': return dir.workers.get(r.describerId) || '— лікар не вказаний —';
    case 'rRef': return ref.self ? 'Самоскерування' : (dir.institutions.get(ref.institutionId) || ref.institutionName || '— без установи —');
    case 'rLbl': return dir.labels.get(r.labelId) || '— без мітки —';
    case 'rDisc': return r.discountSnapshot ? `${r.discountSnapshot.name} −${r.discountSnapshot.percent}%` : 'Без пільги';
    case 'rSvc': return r.serviceSnapshot?.name || '—';
    case 'rPay': return r.date;
    default: return r.date;   // rPat: підсумки по днях — без прізвищ пацієнтів
  }
}
export const GROUP_TITLE = { rPat: 'День', rLab: 'Лаборант', rDoc: 'Лікар (описує)', rRef: 'Установа', rLbl: 'Розподіл', rPay: 'День', rDisc: 'Пільга', rSvc: 'Послуга' };

/** Таблиця звіту: рядки по групах + «Разом». Суми — totalAmount (після знижки, з додатковими). */
export function buildTable(report, recs, dir, facilityPays = true) {
  const g = new Map();
  for (const r of recs) {
    const k = groupKey(report, r, dir);
    const x = g.get(k) || { k, n: 0, vis: new Set(), pat: new Set(), sum: 0, paid: 0, cash: 0, cashless: 0 };
    x.n++; x.vis.add(r.visitId || r.id); x.pat.add(r.patientId || r.patientName);
    const t = Number(r.totalAmount) || 0; x.sum += t;
    if (r.paid) { x.paid += t; if (r.paymentMethod === 'cash') x.cash += t; else if (r.paymentMethod === 'cashless') x.cashless += t; }
    g.set(k, x);
  }
  const pay = facilityPays && (report === 'rPay');
  const head = [GROUP_TITLE[report] || 'Група', 'Послуг', 'Візитів', 'Пацієнтів', 'Сума, грн', ...(pay ? ['Оплачено', 'Безготівка', 'Готівка', 'Неоплачено'] : [])];
  const rows = [...g.values()].sort((a, b) => report === 'rPay' || report === 'rPat' ? a.k.localeCompare(b.k) : b.sum - a.sum || b.n - a.n)
    .map((x) => [report === 'rPay' || report === 'rPat' ? uaDate(x.k) : x.k, x.n, x.vis.size, x.pat.size, rnd(x.sum), ...(pay ? [rnd(x.paid), rnd(x.cashless), rnd(x.cash), rnd(x.sum - x.paid)] : [])]);
  const allVis = new Set(recs.map((r) => r.visitId || r.id)), allPat = new Set(recs.map((r) => r.patientId || r.patientName));
  const sum = recs.reduce((a, r) => a + (Number(r.totalAmount) || 0), 0), paid = recs.filter((r) => r.paid).reduce((a, r) => a + (Number(r.totalAmount) || 0), 0);
  const cash = recs.filter((r) => r.paid && r.paymentMethod === 'cash').reduce((a, r) => a + (Number(r.totalAmount) || 0), 0);
  const cl = recs.filter((r) => r.paid && r.paymentMethod === 'cashless').reduce((a, r) => a + (Number(r.totalAmount) || 0), 0);
  const total = ['Разом', recs.length, allVis.size, allPat.size, rnd(sum), ...(pay ? [rnd(paid), rnd(cl), rnd(cash), rnd(sum - paid)] : [])];
  return { head, rows, total };
}
const rnd = (x) => Math.round(x * 100) / 100;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nf = (v) => typeof v === 'number' ? v.toLocaleString('uk-UA') : esc(v);
export function emailHtml({ facility, name, period, table }) {
  const th = table.head.map((h, i) => `<th style="padding:6px 10px;text-align:${i ? 'right' : 'left'};background:#E4F3EB;color:#1F3A34;border-bottom:2px solid #1F3A34">${esc(h)}</th>`).join('');
  const tr = (r, b) => `<tr>${r.map((c, i) => `<td style="padding:6px 10px;text-align:${i ? 'right' : 'left'};border-bottom:1px solid #d0d7e0;${b ? 'font-weight:700' : ''}">${nf(c)}</td>`).join('')}</tr>`;
  return `<div style="font-family:Arial,sans-serif;color:#1F3A34"><h2 style="margin:0 0 4px;color:#1E6B4F">${esc(name)}</h2><div style="color:#6B7B78;margin-bottom:14px">${esc(facility)} · ${esc(period)}</div>
  ${table.rows.length ? `<table style="border-collapse:collapse;font-size:13px"><thead><tr>${th}</tr></thead><tbody>${table.rows.map((r) => tr(r)).join('')}${tr(table.total, true)}</tbody></table>` : '<p>За цей період даних немає.</p>'}
  <p style="color:#6B7B78;font-size:12px;margin-top:16px">Повна таблиця — у вкладеному файлі Excel. Лист сформовано автоматично; щоб змінити розклад, відкрийте «Звіти → Автоматичні звіти» у програмі.</p></div>`;
}
