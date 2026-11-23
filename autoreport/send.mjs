/* Надсилання автозвітів. Запускається в GitHub Actions кожні 30 хвилин (.github/workflows/autoreport.yml).
   Потрібні секрети: FIREBASE_SERVICE_ACCOUNT (JSON сервісного акаунта), SMTP_USER, SMTP_PASS (пароль застосунку Gmail),
   необов'язково SMTP_HOST (за замовчуванням smtp.gmail.com), SMTP_PORT (465). Змінна DRY_RUN=1 — лише показати, що було б надіслано. */
import admin from 'firebase-admin';
import nodemailer from 'nodemailer';
import ExcelJS from 'exceljs';
import { kyivNow, isDue, periodOf, periodLabel, buildTable, emailHtml } from './lib.mjs';

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) { console.error('Немає секрету FIREBASE_SERVICE_ACCOUNT'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
const db = admin.firestore();
const dry = process.env.DRY_RUN === '1';

const n = kyivNow();
const snap = await db.collection('auto_reports').get();
const due = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => isDue(a, n));
console.log(`Київ ${n.date} ${n.hm}: автозвітів у базі ${snap.size}, до надсилання ${due.length}`);
if (!due.length) process.exit(0);

const settings = (await db.doc('settings/main').get()).data() || {};
const facility = settings.facilityName || 'CT/MRI';
const payOn = settings.journalPay !== false;
const nameMap = async (col, f) => new Map((await db.collection(col).get()).docs.map((d) => [d.id, f(d.data())]));
const short = (p) => ((p.lastName || '') + ' ' + [p.firstName, p.middleName].filter(Boolean).map((x) => x[0].toUpperCase() + '.').join('')).trim() || p.email || '';
const dir = {
  workers: await nameMap('workers', short), labels: await nameMap('labels', (x) => x.name),
  institutions: await nameMap('institutions', (x) => x.name),
};
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com', port: +(process.env.SMTP_PORT || 465), secure: (process.env.SMTP_PORT || '465') === '465',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

let failed = 0;
for (const a of due) {
  try {
    if (a.report === 'rPay' && !payOn) { console.log(`пропуск ${a.id}: облік оплати вимкнено`); continue; }
    const per = periodOf(a.freq, n);
    const recs = (await db.collection('records').where('date', '>=', per[0]).where('date', '<=', per[1]).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const table = buildTable(a.report, recs, dir, payOn);
    const label = periodLabel(a.freq, per);
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Звіт');
    ws.addRow([`${a.name} · ${facility} · ${label}`]).font = { bold: true, size: 13 }; ws.addRow([]);
    const h = ws.addRow(table.head); h.font = { bold: true }; h.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4F3EB' } }; });
    table.rows.forEach((r) => ws.addRow(r)); ws.addRow(table.total).font = { bold: true };
    ws.columns.forEach((c, i) => { c.width = i ? 14 : 34; });
    const buf = await wb.xlsx.writeBuffer();
    const subject = `${a.name} — ${label}`;
    if (dry) console.log(`[DRY] ${subject} → ${a.recipients.join(', ')} (${recs.length} послуг)`);
    else await transport.sendMail({
      from: `"${facility}" <${process.env.SMTP_USER}>`, to: a.recipients.join(', '), subject,
      html: emailHtml({ facility, name: a.name, period: label, table }),
      attachments: [{ filename: `${a.name} ${label}.xlsx`.replace(/[\\/:*?"<>|]/g, '_'), content: Buffer.from(buf) }],
    });
    if (!dry) await db.doc(`auto_reports/${a.id}`).set({ lastRunDate: n.date, lastSentAt: admin.firestore.FieldValue.serverTimestamp(), lastStatus: 'ok' }, { merge: true });
    console.log(`✓ ${subject}`);
  } catch (e) {
    failed++; console.error(`✕ ${a.id}:`, e.message);
    if (!dry) await db.doc(`auto_reports/${a.id}`).set({ lastRunDate: n.date, lastStatus: String(e.message).slice(0, 120) }, { merge: true });
  }
}
process.exit(failed ? 1 : 0);
