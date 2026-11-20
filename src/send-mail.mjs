// Sender en kort morgenmail om dagens fugl via en almindelig Gmail-konto (app-adgangskode).
// Kræver GitHub-hemmelighederne GMAIL_USER, GMAIL_APP_PASSWORD og MAIL_TO (adresser adskilt af komma).
// Modtagerne sendes som BCC, så de ikke kan se hinanden.
import path from 'node:path';
import { ROOT, readJson, readCache } from './common.mjs';
import { SITE_NAME, SITE_URL, SCHEDULE_START } from './config.mjs';

const { GMAIL_USER, GMAIL_APP_PASSWORD, MAIL_TO } = process.env;
if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !MAIL_TO) {
  console.log('Mail er ikke sat op endnu (mangler GMAIL_USER, GMAIL_APP_PASSWORD eller MAIL_TO). Springer over.');
  process.exit(0);
}
const recipients = MAIL_TO.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => /@/.test(s));
if (!recipients.length) { console.log('Ingen gyldige modtagere i MAIL_TO.'); process.exit(0); }

const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(new Date());
const dayIdx = (iso) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${SCHEDULE_START}T12:00:00Z`)) / 864e5);
const order = readJson(path.join(ROOT, 'data', 'raekkefoelge.json'), null)?.dage || [];
const yIso = new Date(Date.parse(`${today}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
const yKey = order[dayIdx(yIso)];
const y = yKey ? readCache(yKey) : null;
const slugs = readJson(path.join(ROOT, 'data', 'slugs.json'), {});
const base = SITE_URL.replace(/\/$/, '');
const no = dayIdx(today) + 1;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dateTxt = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Copenhagen' }).format(new Date());

const yName = y ? (y.names?.da || y.names?.en || y.name) : null;
const ySlug = y ? (slugs[yKey] || null) : null;
const yImg = y?.photos?.hero?.medium || null;

const html = `<!doctype html><html lang="da"><body style="margin:0;background:#f6f5f1;font-family:Inter,Arial,sans-serif;color:#1d211f">
<div style="max-width:520px;margin:0 auto;padding:28px 20px">
  <p style="margin:0;color:#2e6a4f;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">${esc(SITE_NAME)} #${no} · ${esc(dateTxt)}</p>
  <h1 style="font-family:Georgia,serif;font-size:30px;line-height:1.15;margin:8px 0 10px">Hvilken fugl er det i dag?</h1>
  <p style="margin:0 0 20px;font-size:16px;line-height:1.55;color:#4b524e">Lyt til stemmen, se billedet og gæt dagens fugl. Tre forsøg – og bagefter kan du læse alt om den.</p>
  <p style="margin:0 0 28px"><a href="${base}/?utm_source=mail" style="display:inline-block;background:#2e6a4f;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:99px">Gæt dagens fugl</a></p>
  ${y ? `<div style="border-top:1px solid #e2e0d8;padding-top:20px">
    <p style="margin:0 0 10px;font-size:14px;color:#69706b">I går var det …</p>
    ${yImg ? `<img src="${esc(yImg)}" alt="${esc(yName)}" width="480" style="width:100%;max-width:480px;border-radius:12px;display:block;margin:0 0 10px">` : ''}
    <p style="margin:0;font-family:Georgia,serif;font-size:20px;font-weight:700">${ySlug ? `<a href="${base}/fugle/${ySlug}/" style="color:#1d211f">${esc(yName)}</a>` : esc(yName)}</p>
    ${yImg ? `<p style="margin:4px 0 0;font-size:11px;color:#69706b">Foto: ${esc((y.photos.hero.attribution || '').slice(0, 90))} · iNaturalist</p>` : ''}
  </div>` : ''}
  <p style="margin:32px 0 0;font-size:12px;color:#69706b">Du får denne mail, fordi du har bedt om det. Svar bare på mailen, hvis du ikke vil have flere.</p>
</div></body></html>`;

const text = `${SITE_NAME} #${no} – ${dateTxt}\n\nHvilken fugl er det i dag? Gæt den her: ${base}/\n${y ? `\nI går var det: ${yName}${ySlug ? ` – ${base}/fugle/${ySlug}/` : ''}\n` : ''}\nSvar på mailen, hvis du ikke vil have flere.`;

const nodemailer = (await import('nodemailer')).default;
const tx = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
await tx.sendMail({
  from: `"${SITE_NAME}" <${GMAIL_USER}>`,
  to: GMAIL_USER,
  bcc: recipients,
  subject: `Dagens fugl #${no} – kan du gætte den?`,
  text, html,
});
console.log(`Sendt til ${recipients.length} modtager(e).`);
