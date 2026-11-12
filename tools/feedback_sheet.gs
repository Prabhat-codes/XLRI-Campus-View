/**
 * Receives feedback from the map's "Want to improve this map?" form and appends it to this sheet.
 *
 * Setup (once):
 *  1. Open the feedback Google Sheet → Extensions → Apps Script.
 *  2. Replace everything in Code.gs with this file and click Save.
 *  3. Deploy → New deployment → type "Web app".
 *     Execute as: Me.  Who has access: Anyone.  → Deploy, and allow access when asked.
 *  4. Copy the Web app URL (ends in /exec) and put it in site/data/places.json as "feedbackUrl".
 *
 * Each submission adds one row: time (IST), type, feedback, name, contact, and the place the map was showing.
 */
const HEADERS = ['Time (IST)', 'Type', 'Feedback', 'Name', 'Contact', 'Map was showing'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
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

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
