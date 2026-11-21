/**
 * Dagens Fugl – tilmelding og morgenmail.
 * Kører som Google Apps Script på kontoen dagensfugl1@gmail.com.
 * Tilmeldte gemmes i et Google-ark ("Dagens Fugl – tilmeldte") i samme konto.
 * Dobbelt bekræftelse: man er først tilmeldt, når man har klikket på linket i bekræftelsesmailen.
 */
var SITE = 'https://dagensfugl.dk';
var NAME = 'Dagens Fugl';

function sheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : null;
  if (!ss) {
    ss = SpreadsheetApp.create('Dagens Fugl – tilmeldte');
    ss.getSheets()[0].appendRow(['email', 'status', 'token', 'tilmeldt', 'bekræftet', 'afmeldt']);
    props.setProperty('SHEET_ID', ss.getId());
  }
  return ss.getSheets()[0];
}

function rows_() {
  var sh = sheet_();
  var v = sh.getDataRange().getValues();
  return { sh: sh, v: v };
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function page_(title, text) {
  var html = '<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title></head>' +
    '<body style="margin:0;background:#f6f5f1;font-family:Arial,sans-serif;color:#1d211f"><div style="max-width:480px;margin:60px auto;padding:0 20px">' +
    '<p style="color:#2e6a4f;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px">' + NAME + '</p>' +
    '<h1 style="font-family:Georgia,serif">' + title + '</h1><p style="font-size:17px;line-height:1.5">' + text + '</p>' +
    '<p><a href="' + SITE + '" style="display:inline-block;background:#2e6a4f;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:99px">Gå til Dagens Fugl</a></p></div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(title);
}

function url_() { return ScriptApp.getService().getUrl(); }

function doPost(e) {
  var p = (e && e.parameter) || {};
  if (p.website) return json_({ ok: true }); // honningkrukke mod robotter
  var email = String(p.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) return json_({ ok: false, error: 'Ugyldig mailadresse' });
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var r = rows_();
    for (var i = 1; i < r.v.length; i++) {
      if (r.v[i][0] === email) {
        if (r.v[i][1] === 'bekræftet') return json_({ ok: true, already: true });
        var t = r.v[i][2];
        r.sh.getRange(i + 1, 2).setValue('afventer');
        sendConfirm_(email, t);
        return json_({ ok: true });
      }
    }
    var token = Utilities.getUuid();
    r.sh.appendRow([email, 'afventer', token, new Date(), '', '']);
    sendConfirm_(email, token);
    return json_({ ok: true });
  } finally { lock.releaseLock(); }
}

function sendConfirm_(email, token) {
  var link = url_() + '?a=bekraeft&t=' + token;
  MailApp.sendEmail({
    to: email, name: NAME,
    subject: 'Bekræft din tilmelding til Dagens Fugl',
    htmlBody: '<div style="font-family:Arial,sans-serif;max-width:480px;font-size:16px;line-height:1.5;color:#1d211f">' +
      '<p>Hej!</p><p>Tryk på knappen for at få dagens fugl på mail hver morgen:</p>' +
      '<p><a href="' + link + '" style="display:inline-block;background:#2e6a4f;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:99px">Ja tak, tilmeld mig</a></p>' +
      '<p style="color:#69706b;font-size:13px">Har du ikke bedt om det, kan du bare se bort fra denne mail – så sker der ingenting.</p></div>'
  });
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  var t = String(p.t || '');
  if (!t) return page_('Dagens Fugl', 'Her er ikke noget at se.');
  var r = rows_();
  for (var i = 1; i < r.v.length; i++) {
    if (r.v[i][2] === t) {
      if (p.a === 'bekraeft') {
        r.sh.getRange(i + 1, 2).setValue('bekræftet'); r.sh.getRange(i + 1, 5).setValue(new Date());
        return page_('Du er tilmeldt 🎉', 'Fra i morgen tidlig får du dagens fugl på mail. Du kan altid afmelde dig med linket nederst i mailen.');
      }
      if (p.a === 'afmeld') {
        r.sh.getRange(i + 1, 2).setValue('afmeldt'); r.sh.getRange(i + 1, 6).setValue(new Date());
        return page_('Du er afmeldt', 'Du får ikke flere mails fra Dagens Fugl. Du er altid velkommen tilbage på siden.');
      }
    }
  }
  return page_('Linket virker ikke', 'Linket er for gammelt eller forkert. Prøv at tilmelde dig igen på dagensfugl.dk.');
}

/** Sendes hver morgen af en tidsudløser (se opsaetning). */
function sendMorgenmail() {
  var data = JSON.parse(UrlFetchApp.fetch(SITE + '/mail.json?t=' + Date.now(), { muteHttpExceptions: false }).getContentText());
  var r = rows_();
  var sent = 0;
  for (var i = 1; i < r.v.length; i++) {
    if (r.v[i][1] !== 'bekræftet') continue;
    if (MailApp.getRemainingDailyQuota() < 1) break;
    var unsub = url_() + '?a=afmeld&t=' + r.v[i][2];
    MailApp.sendEmail({ to: r.v[i][0], name: NAME, subject: data.subject, htmlBody: data.html.replace('{{AFMELD}}', unsub), body: data.text.replace('{{AFMELD}}', unsub) });
    sent++;
  }
  console.log('Sendt: ' + sent);
}

/** Kør én gang: opretter arket og morgenudløseren (ca. kl. 7 dansk tid). */
function opsaetning() {
  sheet_();
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'sendMorgenmail') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('sendMorgenmail').timeBased().everyDays(1).atHour(7).inTimezone('Europe/Copenhagen').create();
  console.log('Klar. Ark: ' + sheet_().getParent().getUrl());
}
