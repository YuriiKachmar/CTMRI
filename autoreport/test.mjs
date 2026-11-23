import assert from 'node:assert/strict';
import { kyivNow, isDue, periodOf, periodLabel, buildTable, emailHtml } from './lib.mjs';
// 2026-11-23 — понеділок; Київ взимку UTC+2
const n = kyivNow(new Date('2026-11-23T06:40:00Z'));
assert.deepEqual([n.date, n.hm, n.dow], ['2026-11-23', '08:40', 1]);
assert.equal(kyivNow(new Date('2026-11-23T22:30:00Z')).date, '2026-11-24');
assert.deepEqual(periodOf('daily', n), ['2026-11-22', '2026-11-22']);
assert.deepEqual(periodOf('weekly', n), ['2026-11-16', '2026-11-22']);
assert.deepEqual(periodOf('monthly', n), ['2026-10-01', '2026-10-31']);
const n2 = kyivNow(new Date('2027-01-01T08:00:00Z'));  // 1 січня, пʼятниця
assert.deepEqual(periodOf('monthly', n2), ['2026-12-01', '2026-12-31']);
assert.deepEqual(periodOf('daily', n2), ['2026-12-31', '2026-12-31']);
assert.deepEqual(periodOf('weekly', n2), ['2026-12-21', '2026-12-27']);
const base = { active: true, recipients: ['a@b.ua'], freq: 'daily', time: '08:30' };
assert.equal(isDue(base, n), true);
assert.equal(isDue({ ...base, time: '09:00' }, n), false);
assert.equal(isDue({ ...base, lastRunDate: '2026-11-23' }, n), false);
assert.equal(isDue({ ...base, active: false }, n), false);
assert.equal(isDue({ ...base, recipients: [] }, n), false);
assert.equal(isDue({ ...base, freq: 'weekly', day: 2 }, n), false);
assert.equal(isDue({ ...base, freq: 'weekly', day: 1 }, n), true);
assert.equal(isDue({ ...base, freq: 'monthly', day: 1 }, n), false);
assert.equal(periodLabel('monthly', ['2026-10-01', '2026-10-31']), 'жовтень 2026');
const dir = { workers: new Map([['w1', 'Іваненко І.']]), labels: new Map(), institutions: new Map([['i1', 'Клініка']]) };
const recs = [
  { id: 'r1', visitId: 'v1', patientId: 'p1', date: '2026-11-22', totalAmount: 1000, paid: true, paymentMethod: 'cash', labTechId: 'w1', referral: { institutionId: 'i1' } },
  { id: 'r2', visitId: 'v1', patientId: 'p1', date: '2026-11-22', totalAmount: 500, paid: false, labTechId: 'w1', referral: { institutionId: 'i1' } },
  { id: 'r3', visitId: 'v2', patientId: 'p2', date: '2026-11-22', totalAmount: 700, paid: true, paymentMethod: 'cashless', labTechId: 'w1', referral: { self: true } },
];
const t = buildTable('rPay', recs, dir);
assert.deepEqual(t.total, ['Разом', 3, 2, 2, 2200, 1700, 700, 1000, 500]);
assert.deepEqual(buildTable('rLab', recs, dir).rows[0], ['Іваненко І.', 3, 2, 2, 2200]);
assert.deepEqual(buildTable('rRef', recs, dir).rows.map((r) => r[0]).sort(), ['Клініка', 'Самоскерування']);
assert.equal(buildTable('rPay', recs, dir, false).head.length, 5);
assert.ok(!JSON.stringify(buildTable('rPat', recs, dir)).includes('Петро'));
assert.match(emailHtml({ facility: 'Ф<>', name: 'N', period: 'p', table: t }), /Ф&lt;&gt;/);
console.log('OK: усі перевірки пройдено');
