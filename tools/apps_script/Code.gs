/**
 * XLRI Campus View: the sheet's backend. Paste Code.gs AND CampusData.gs into the sheet's Apps Script project.
 *
 * Tabs it uses (created automatically):
 *   Sheet1     feedback from the "Want to improve this map?" form
 *   Questions  every Ask Me Anything question, column B says if it could be answered
 *   Stores     one row per campus shop: Store | Password. Run setupStores() once to fill it with random passwords;
 *              change any password by editing the cell. Hand each store its password with its QR code.
 *   Status     latest Open/Closed tap per store (one row each, replaced on every tap)
 *   Settings   campus_code: the code people enter to unlock phone numbers. setupStores() creates a random one.
 *
 * Web-app actions (GET ?action=...):
 *   status                      -> {ok, status: {store: {open, at}}}         public
 *   campus&code=...             -> {ok, data: CAMPUS_DATA} when the code matches
 *   login&store=..&pw=..        -> {ok} when the password matches
 *   set&store=..&pw=..&open=1|0 -> records the tap
 *
 * After any change: Deploy -> Manage deployments -> pencil -> Version: New version -> Deploy. The URL stays the same.
 */
const STORES = ["Aiyer's Café", 'Jampot', 'Bishu Da', 'Aziz Juice Center', 'Shaligram', 'Jaima', 'Gents Saloon',
  'Campus Cafe', 'Dadoos', 'XLRI Dhaba', 'GMP Mess'];
const HEADERS = ['Time (IST)', 'Type', 'Feedback', 'Name', 'Contact', 'Map was showing'];

const Q_HEADERS = ['Question', 'Could answer?', 'Time (IST)', 'Typed or preset'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const q = (e && e.parameter) || {};
    if (q.kind === 'question') return logQuestion(q);
    const book = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = book.getSheetByName('Sheet1') || book.getSheets()[0];   // feedback tab; questions go to their own tab
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    const p = (e && e.parameter) || {};
    // trim lengths, and stop text that starts with = + - @ from being read as a formula
    const clean = (v, max) => {
      const s = String(v || '').slice(0, max);
      return /^[=+\-@]/.test(s) ? "'" + s : s;
    };
    if (!clean(p.message, 2000).trim()) return reply({ ok: false, error: 'empty' });
    sheet.appendRow([
      Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
      clean(p.type, 40),
      clean(p.message, 2000),
      clean(p.name, 100),
      clean(p.contact, 150),
      clean(p.where, 120),
    ]);
    return reply({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function logQuestion(p) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = book.getSheetByName('Questions') || book.insertSheet('Questions');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(Q_HEADERS);
    sheet.getRange(1, 1, 1, Q_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  const clean = (v, max) => { const s = String(v || '').slice(0, max); return /^[=+\-@]/.test(s) ? "'" + s : s; };
  const question = clean(p.question, 500).trim();
  if (!question) return reply({ ok: false, error: 'empty' });
  const answered = p.answered === 'Yes' ? 'Yes' : 'No';
  sheet.appendRow([question, answered, Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'), p.source === 'preset' ? 'Preset' : 'Typed']);
  if (answered === 'No') sheet.getRange(sheet.getLastRow(), 2).setBackground('#fde2e1');
  return reply({ ok: true });
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'status') return reply({ ok: true, status: readStatus() });
  if (p.action === 'campus') return setting('campus_code') && p.code === setting('campus_code') ? reply({ ok: true, data: CAMPUS_DATA }) : reply({ ok: false, error: 'code' });
  if (p.action === 'login') return reply({ ok: checkStore(p.store, p.pw) });
  if (p.action === 'set') {
    if (!checkStore(p.store, p.pw)) return reply({ ok: false, error: 'password' });
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try { writeStatus(p.store, p.open === '1'); } finally { lock.releaseLock(); }
    return reply({ ok: true, status: readStatus()[p.store] });
  }
  return reply({ ok: false, error: 'unknown action' });
}

function tab(name, headers) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sh = book.getSheetByName(name);
  if (!sh) { sh = book.insertSheet(name); sh.appendRow(headers); sh.getRange(1, 1, 1, headers.length).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
function setting(key) {
  const rows = tab('Settings', ['Key', 'Value']).getDataRange().getValues();
  const r = rows.find((x) => x[0] === key);
  return r ? String(r[1]).trim() : '';
}
function checkStore(store, pw) {
  if (!store || !pw) return false;
  const rows = tab('Stores', ['Store', 'Password']).getDataRange().getValues().slice(1);
  return rows.some((r) => r[0] === store && String(r[1]).trim() !== '' && String(r[1]).trim() === String(pw).trim());
}
function writeStatus(store, open) {
  const sh = tab('Status', ['Store', 'Status', 'Updated (IST)', 'Updated (epoch ms)']);
  const rows = sh.getDataRange().getValues();
  const now = new Date();
  const row = [store, open ? 'Open' : 'Closed', Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'), now.getTime()];
  const i = rows.findIndex((r, k) => k > 0 && r[0] === store);
  if (i > 0) sh.getRange(i + 1, 1, 1, 4).setValues([row]); else sh.appendRow(row);
}
function readStatus() {
  const out = {};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Status');
  if (!sh) return out;
  for (const r of sh.getDataRange().getValues().slice(1)) if (r[0]) out[r[0]] = { open: r[1] === 'Open', at: Number(r[3]) };
  return out;
}

/** Run once from the editor (select setupStores, press Run): fills Stores with random passwords and sets a campus code. */
function setupStores() {
  const sh = tab('Stores', ['Store', 'Password']);
  const have = sh.getDataRange().getValues().slice(1).map((r) => r[0]);
  const rnd = () => String(Math.floor(100000 + Math.random() * 900000));
  for (const s of STORES) if (!have.includes(s)) sh.appendRow([s, rnd()]);
  const set = tab('Settings', ['Key', 'Value']);
  if (!setting('campus_code')) set.appendRow(['campus_code', 'XL' + rnd()]);
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
