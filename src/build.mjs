// Bygger hele den statiske side i dist/ ud fra data/cache.
// Ingen eksterne pakker – kun Node.

import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, DIST_DIR, SLUGS_FILE, loadSpeciesList, readCache, readJson, writeJson, slugify,
} from './common.mjs';
import {
  SITE_NAME, SITE_URL, BASE_PATH, TIMEZONE, SCHEDULE_START, SCHEDULE_SEED, ALLOW_NONCOMMERCIAL,
} from './config.mjs';
import { makeV2 } from './v2.mjs';

// Hvem står bag siden (vises på privatlivssiden). Sættes som repository variables i GitHub.
const OWNER_NAME = process.env.OWNER_NAME || '';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'dagensfugl1@gmail.com';
const CF_BEACON = process.env.CF_BEACON || '30f01a95178a48b2ba5fca5113bc1704';
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://script.google.com/macros/s/AKfycbwm8sViqs60dkKjtEqe4VVQIheSLvjOhUwgyvatDyNnt2CziwNChLGnjVVjiuBSRRz5/exec'; // Apps Script-webapp til tilmelding (se apps-script/) // token til Cloudflare Web Analytics (uden cookies)
const mailto = (subject, body = '') => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ''}`;

// ---------------- Hjælpere ----------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const url = (p) => `${BASE_PATH}/${p.replace(/^\//, '')}`;
const abs = (p) => `${SITE_URL}/${p.replace(/^\//, '')}`;
const nf = new Intl.NumberFormat('da-DK');
const regionNames = new Intl.DisplayNames(['da'], { type: 'region' });
const MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
const MONTH_SLUGS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

const LICENSES = {
  'cc0': { label: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/deed.da' },
  'cc-by': { label: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/deed.da' },
  'cc-by-sa': { label: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.da' },
  'cc-by-nc': { label: 'CC BY-NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/deed.da' },
  'cc-by-nc-sa': { label: 'CC BY-NC-SA 4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.da' },
};

function todayISO(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE }).format(date); // YYYY-MM-DD
}
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
function longDate(iso) {
  return new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${iso}T12:00:00Z`));
}
function shortDate(iso) {
  return new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
}
const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function write(rel, content) {
  const file = path.join(DIST_DIR, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name); const d = path.join(dst, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

// ---------------- Dagens fugl: fast rækkefølge ----------------
// Alle arter vises én gang i tilfældig (men fast) rækkefølge, før nogen gentages.
function hashStr(s) { let h = 1779033703 ^ s.length; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return h >>> 0; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function permutation(keys, cycle) {
  const arr = [...keys].sort();
  const rnd = mulberry32(hashStr(`${SCHEDULE_SEED}:${cycle}`));
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function birdForDate(iso, allKeys, readySet) {
  const day = Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${SCHEDULE_START}T12:00:00Z`)) / 864e5);
  const n = allKeys.length;
  const cycle = Math.floor(day / n);
  const perm = permutation(allKeys, cycle);
  const start = ((day % n) + n) % n;
  for (let k = 0; k < n; k++) { // spring arter over, som endnu ikke har data
    const key = perm[(start + k) % n];
    if (readySet.has(key)) return key;
  }
  return null;
}

// ---------------- Indhold pr. art ----------------
function displayName(d) { return d.names.da ? d.names.da.replace(/ (\p{Lu})/gu, (m, c) => ' ' + c.toLowerCase()) : d.names.en || d.name; }

function thumb(photo) {
  return photo?.medium ? photo.medium.replace('/medium.', '/small.') : null;
}

// iNaturalist har fotos i flere størrelser: small 240, medium 500, large 1024, original op til 2048 px.
const size = (photo, s) => photo.medium.replace('/medium.', `/${s}.`);
function srcset(photo, sizes) {
  return sizes.map(([s, w]) => `${esc(size(photo, s))} ${w}w`).join(', ');
}

function credit(photo) {
  const lic = LICENSES[photo.license] || { label: photo.license.toUpperCase(), url: '#' };
  const who = photo.attribution ? esc(photo.attribution.replace(/\s*\(c\)\s*/i, '© ').replace(/, (some|no) rights reserved.*$/i, '').replace(/\s*uploaded by.*$/i, '')) : 'Ukendt fotograf';
  const where = [photo.place, photo.date].filter(Boolean).map(esc).join(', ');
  return `<span class="credit">${who} · <a href="${lic.url}" rel="license noopener" target="_blank">${lic.label}</a> · <a href="${esc(photo.source)}" rel="noopener" target="_blank">iNaturalist</a>${where ? `<span class="where"> · ${where}</span>` : ''}</span>`;
}

function figure(photo, alt, cls = '', eager = false) {
  const hero = cls.includes('hero');
  const set = hero
    ? `src="${esc(size(photo, 'large'))}" srcset="${srcset(photo, [['medium', 500], ['large', 1024], ['original', 2048]])}" sizes="(min-width: 1100px) 1000px, 100vw"`
    : `src="${esc(photo.medium)}" srcset="${srcset(photo, [['medium', 500], ['large', 1024]])}" sizes="(min-width: 900px) 320px, 50vw"`;
  return `<figure class="${cls}"><img ${set} alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"><figcaption>${credit(photo)}</figcaption></figure>`;
}

const PLUMAGE = [
  { key: 'male', label: 'Han' },
  { key: 'female', label: 'Hun' },
  { key: 'juvenile', label: 'Ungfugl' },
  { key: 'adult', label: 'Voksen' },
  { key: 'general', label: 'Flere billeder' },
];

function plumageSection(d) {
  const p = d.photos || {};
  const heroId = p.hero?.id;
  const groups = PLUMAGE
    .map((g) => ({ ...g, photos: (p[g.key] || []).filter((x) => x.id !== heroId || (p[g.key] || []).length === 1) }))
    .filter((g) => g.photos.length);
  if (!groups.length) return '';
  const name = displayName(d);
  return `<section class="block" id="dragt">
  <h2>Fjerdragt</h2>
  <p class="lede">Fotos hvor iNaturalist-brugerne har markeret køn eller alder. ${groups.length < 3 ? 'For nogle arter findes kun få markerede billeder med fri licens.' : ''}</p>
  ${groups.map((g) => `<div class="plumage">
    <h3>${g.label}</h3>
    <div class="grid">${g.photos.map((ph) => figure(ph, `${name}, ${g.label.toLowerCase()}`)).join('')}</div>
  </div>`).join('\n')}
</section>`;
}

function soundSection(d) {
  const so = d.sound;
  if (!so?.src?.length) return '';
  return `<section class="block small" id="lyd">
  <h2>Hør den</h2>
  <audio controls preload="none">${so.src.map((x) => `<source src="${esc(x.u)}"${x.type && x.type !== 'application/ogg' ? ` type="${esc(x.type)}"` : ''}>`).join('')}</audio>
  <p class="source">Optagelse: ${esc(so.artist || 'ukendt')} · ${so.licenseUrl ? `<a href="${esc(so.licenseUrl)}" rel="license noopener" target="_blank">${esc(so.license)}</a>` : esc(so.license)} · <a href="${esc(so.page)}" rel="noopener" target="_blank">${esc(so.via || 'Wikimedia Commons')}</a>${so.type ? ` · ${esc(so.type)}` : ''}</p>
</section>`;
}

function signupBox() {
  if (!SIGNUP_URL) return '';
  return `<aside class="signup" id="tilmeld">
  <div><strong>Få dagens fugl på mail</strong><span>En kort mail hver morgen ca. kl. 7 med dagens gætteleg – og svaret fra i går. Gratis, og du kan altid afmelde dig.</span></div>
  <form class="signup-form" data-url="${esc(SIGNUP_URL)}">
    <input type="email" name="email" required placeholder="Din mailadresse" autocomplete="email" aria-label="Din mailadresse">
    <input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
    <button type="submit" class="button">Tilmeld</button>
  </form>
  <p class="signup-msg" aria-live="polite"></p>
  <p class="signup-note">Vi gemmer kun din mailadresse og bruger den kun til mailen. Se <a href="${url('privatliv/')}">privatliv</a>.</p>
</aside>`;
}

const TEXT_PARTS = [['kendetegn', 'Kendetegn'], ['stemme', 'Stemme'], ['levested', 'Hvor lever den?'], ['foede', 'Hvad spiser den?'], ['i_danmark', 'I Danmark']];

function aboutSection(d) {
  if (d.tekst) {
    const wiki = d.wiki ? ` Vil du vide mere, så læs <a href="${esc(d.wiki.url)}" rel="noopener" target="_blank">artiklen på ${d.wiki.lang === 'da' ? 'dansk' : 'engelsk'} Wikipedia</a>.` : '';
    return `<section class="block" id="om">
  <h2>Om fuglen</h2>
  <div class="prose facts">${TEXT_PARTS.filter(([k]) => d.tekst[k]).map(([k, h]) => `<h3>${h}</h3><p>${esc(d.tekst[k])}</p>`).join('')}</div>
  <p class="source">Tekst: ${esc(SITE_NAME)}.${wiki}</p>
</section>`;
  }
  if (!d.wiki?.extract) return '';
  const lang = d.wiki.lang === 'da' ? 'dansk' : 'engelsk';
  return `<section class="block" id="om">
  <h2>Om fuglen</h2>
  <div class="prose"${d.wiki.lang !== 'da' ? ' lang="en"' : ''}><p>${esc(d.wiki.extract).replace(/\n+/g, '</p><p>')}</p></div>
  <p class="source">Tekst fra <a href="${esc(d.wiki.url)}" rel="noopener" target="_blank">${lang} Wikipedia</a> (artiklen «${esc(d.wiki.title)}»), <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.da" rel="license noopener" target="_blank">CC BY-SA 4.0</a>.</p>
</section>`;
}

// Beskriv sæsonen ud fra fund pr. måned
function seasonText(months) {
  const max = Math.max(...months);
  if (!max) return null;
  const min = Math.min(...months);
  if (min >= 0.3 * max) return 'Den kan ses i Danmark hele året.';
  const on = months.map((v) => v >= 0.25 * max);
  // find sammenhængende perioder (rundt om nytår)
  const ranges = [];
  let start = on.findIndex((x, i) => x && !on[(i + 11) % 12]);
  if (start < 0) return 'Den kan ses i Danmark hele året.';
  for (let k = 0; k < 12; k++) {
    const i = (start + k) % 12;
    if (on[i] && !on[(i + 11) % 12]) ranges.push([i, i]);
    else if (on[i]) ranges[ranges.length - 1][1] = i;
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const txt = ranges.map(([a, b]) => (a === b ? MONTHS[a] : `${MONTHS[a]}–${MONTHS[b]}`));
  const joined = txt.length > 1 ? `${txt.slice(0, -1).join(', ')} og ${txt.at(-1)}` : txt[0];
  return `Den ses især i Danmark i ${joined}.`;
}

function monthChart(months, counts = months) {
  const max = Math.max(...months) || 1;
  const W = 600; const H = 180; const pad = 24; const bw = (W - 8) / 12;
  const bars = months.map((v, i) => {
    const h = Math.max(counts[i] > 0 ? 2 : 0, Math.round((v / max) * (H - pad - 10)));
    return `<g><title>${capFirst(MONTHS[i])}: ${nf.format(counts[i])} registreringer</title><rect x="${(4 + i * bw + 4).toFixed(1)}" y="${H - pad - h}" width="${(bw - 8).toFixed(1)}" height="${h}" rx="3" class="bar"/><text x="${(4 + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="axis">${MONTHS_SHORT[i]}</text></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Antal registrerede fund i Danmark pr. måned"><line x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}" class="baseline"/>${bars}</svg>`;
}

function whenSection(d) {
  const g = d.gbif;
  if (!g) return '';
  const gbifUrl = `https://www.gbif.org/species/${g.key}`;
  const src = `<p class="source">Data: <a href="${gbifUrl}" rel="noopener" target="_blank">GBIF.org</a> – registrerede fund fra bl.a. naturdatabaser og citizen science. Antallet afspejler også, hvornår folk er ude og kigge.</p>`;
  if (g.dkTotal >= 20) {
    return `<section class="block" id="hvornaar">
  <h2>Hvornår ses den i Danmark?</h2>
  <p class="big">${esc(seasonText(relMonths(g.dkMonths)))}</p>
  ${monthChart(relMonths(g.dkMonths), g.dkMonths)}
  <p class="muted">Baseret på ${nf.format(g.dkTotal)} registreringer fra Danmark i GBIF. Søjlerne er korrigeret for, at der generelt er flere fuglekiggere ude i nogle måneder end i andre.</p>
  ${src}
</section>`;
  }
  if (g.dkTotal > 0 && d.region !== 'dk') {
    return `<section class="block" id="hvornaar">
  <h2>Ses den i Danmark?</h2>
  <p class="big">Den står ikke på Den danske liste.</p>
  <p class="muted">Der er ${nf.format(g.dkTotal)} registreringer fra Danmark i GBIF. Den slags fund er typisk fugle, der er undsluppet fra fangenskab, og de tæller ikke som vilde fund.</p>
  ${src}
</section>`;
  }
  if (g.dkTotal > 0) {
    return `<section class="block" id="hvornaar">
  <h2>Ses den i Danmark?</h2>
  <p class="big">Den er en sjælden gæst – der er kun ${nf.format(g.dkTotal)} registreringer fra Danmark i GBIF.</p>
  <p class="muted">Fund af sjældne arter skal som regel godkendes af DOF's Sjældenhedsudvalg (SU). Antallet her er registreringer i GBIF, ikke antal godkendte fund.</p>
  ${src}
</section>`;
  }
  if (d.region === 'verden') {
    return `<section class="block" id="hvornaar">
  <h2>Ses den i Danmark?</h2>
  <p class="big">Nej. Den står ikke på Den danske liste og er aldrig truffet som vildtlevende fugl i Danmark.</p>
  ${src}
</section>`;
  }
  return '';
}

function whereSection(d) {
  const g = d.gbif;
  if (!g || !g.worldTotal) return '';
  const countries = (g.topCountries || []).filter((c) => c.code && c.code.length === 2).slice(0, 8);
  let names = '';
  if (countries.length) {
    const items = countries.map((c) => {
      let n; try { n = regionNames.of(c.code); } catch { n = c.code; }
      return `<li><span>${esc(n)}</span><span class="num">${nf.format(c.count)}</span></li>`;
    }).join('');
    names = `<h3>Lande med flest registrerede fund</h3><ol class="countries">${items}</ol>`;
  }
  const dkMap = g.dkTotal > 0 ? `<figure class="map-wrap"><div class="map" data-map="dk" data-taxon="${g.key}" aria-label="Kort over fund i Danmark"></div><figcaption>Fund i Danmark</figcaption></figure>` : '';
  return `<section class="block" id="hvor">
  <h2>Hvor findes den?</h2>
  <div class="maps ${dkMap ? 'two' : 'one'}">
    ${dkMap}
    <figure class="map-wrap"><div class="map" data-map="world" data-taxon="${g.key}" aria-label="Verdenskort over fund"></div><figcaption>Fund i hele verden (${nf.format(g.worldTotal)} i alt)</figcaption></figure>
  </div>
  ${names}
  <p class="source">Kort: fund fra <a href="https://www.gbif.org/species/${g.key}" rel="noopener" target="_blank">GBIF.org</a>. Baggrundskort © <a href="https://www.openstreetmap.org/copyright" rel="noopener" target="_blank">OpenStreetMap</a>-bidragydere, © OpenMapTiles.</p>
</section>`;
}

function sourcesSection(d) {
  const links = [];
  if (d.wiki) links.push(`<li><a href="${esc(d.wiki.url)}" rel="noopener" target="_blank">Wikipedia: ${esc(d.wiki.title)}</a></li>`);
  if (d.inat?.id) links.push(`<li><a href="https://www.inaturalist.org/taxa/${d.inat.id}" rel="noopener" target="_blank">iNaturalist: ${esc(d.names.accepted)}</a>${d.inat.observations ? ` (${nf.format(d.inat.observations)} observationer)` : ''}</li>`);
  if (d.gbif?.key) links.push(`<li><a href="https://www.gbif.org/species/${d.gbif.key}" rel="noopener" target="_blank">GBIF: ${esc(d.names.accepted)}</a></li>`);
  if (d.wikidata?.id) links.push(`<li><a href="https://www.wikidata.org/wiki/${d.wikidata.id}" rel="noopener" target="_blank">Wikidata: ${d.wikidata.id}</a></li>`);
  if (!links.length) return '';
  return `<section class="block small" id="kilder">
  <h2>Kilder</h2>
  <ul class="links">${links.join('')}</ul>
  <p class="muted">Data hentet ${esc(new Intl.DateTimeFormat('da-DK', { dateStyle: 'long' }).format(new Date(d.fetchedAt)))}. Se også <a href="${url('kilder/')}">om kilder og licenser</a>.</p>
</section>`;
}

// Hvor mange fugle der i alt registreres i Danmark pr. måned (alle arter samlet).
// Bruges til at rette for, at folk er mere ude og kigge om foråret end om vinteren.
let EFFORT = Array(12).fill(1);
function relMonths(mo) {
  const r = mo.map((v, i) => v / (EFFORT[i] || 1));
  const mx = Math.max(...r);
  return mx ? r.map((v) => v / mx) : r;
}

// Sættes i main() ud fra byggedatoen (siden bygges hver nat).
let NOW_MONTH = new Date().getMonth();

function seasonNow(d) {
  const g = d.gbif;
  const m = NOW_MONTH;
  const name = MONTHS[m];
  if (!g) return null;
  if (g.dkTotal >= 20 && Array.isArray(g.dkMonths)) {
    const mo = relMonths(g.dkMonths); const mx = 1;
    const share = mo[m];
    if (Math.min(...mo) >= 0.45) return { level: 'god', text: `Ses hele året – også i ${name}`, more: '' };
    const best = mo.map((v, i) => [v, i]).filter(([v]) => v >= 0.6 * mx).map(([, i]) => i);
    const bestTxt = best.length && best.length < 12 ? ` Bedst i ${rangeText(best)}.` : '';
    if (share >= 0.6) return { level: 'god', text: `Gode chancer i ${name}`, more: share === 1 ? 'Det er den måned, den ses mest.' : '' };
    if (share >= 0.25) return { level: 'mulig', text: `Kan ses i ${name}`, more: `Men ikke så ofte som på andre tider af året.${bestTxt}` };
    if (share >= 0.05) return { level: 'svag', text: `Sjælden i ${name}`, more: bestTxt.trim() };
    return { level: 'ingen', text: `Ses normalt ikke i ${name}`, more: bestTxt.trim() };
  }
  if (d.region !== 'dk') return { level: 'ingen', text: g.dkTotal > 0 ? 'Ikke på Den danske liste – fund her er typisk undslupne fugle' : 'Aldrig truffet vildtlevende i Danmark', more: '' };
  if (g.dkTotal > 0) return { level: 'svag', text: 'Sjælden gæst i Danmark', more: '' };
  return null;
}

function rangeText(idx) {
  // sammenhængende måneder → "april–august", flere perioder adskilles med "og"
  const set = new Set(idx); const out = [];
  let start = idx.find((i) => !set.has((i + 11) % 12));
  if (start === undefined) return 'hele året';
  for (let k = 0; k < 12; k++) {
    const i = (start + k) % 12;
    if (set.has(i) && !set.has((i + 11) % 12)) out.push([i, i]);
    else if (set.has(i)) out[out.length - 1][1] = i;
  }
  const t = out.map(([a, b]) => (a === b ? MONTHS[a] : `${MONTHS[a]}–${MONTHS[b]}`));
  return t.length > 1 ? `${t.slice(0, -1).join(', ')} og ${t.at(-1)}` : t[0];
}

function speciesBody(d, { headingTag = 'h1', kicker = '' } = {}) {
  const name = displayName(d);
  const alt = d.names.da && d.names.en ? `<span class="alt">${esc(d.names.en)}</span>` : '';
  const rare = d.region === 'dk' && (d.gbif?.dkTotal ?? 0) < 20;
  const tag = rare ? '<span class="tag rare">Sjælden gæst i Danmark</span>' : d.region === 'dk' ? '<span class="tag">Dansk fugl</span>' : '<span class="tag">Udenlandsk fugl</span>';
  const hero = d.photos?.hero ? figure(d.photos.hero, name, 'hero', true) : '';
  return `<article class="species" data-key="${esc(d.key)}" data-region="${d.region}">
  <header class="species-head">
    ${kicker}
    <${headingTag}>${esc(name)}</${headingTag}>
    <p class="sci"><i>${esc(d.names.accepted)}</i>${alt}${tag}</p>
    ${(() => { const n = seasonNow(d); return n ? `<p class="now now-${n.level}"><span class="now-dot" aria-hidden="true"></span><strong>${esc(n.text)}</strong>${n.more ? ` <span>${esc(n.more)}</span>` : ''}</p>` : ''; })()}
    <div class="seen-box" hidden>
      <div class="seen-row">
        <button type="button" class="seen-btn" aria-pressed="false"><span class="seen-icon" aria-hidden="true"></span><span class="seen-label">Jeg har set den</span></button>
        <a class="seen-count" href="${url('mine/')}"></a>
      </div>
      <form class="seen-note" hidden>
        <label>Hvor så du den? <input type="text" name="sted" maxlength="80" placeholder="Fx Amager Fælled"></label>
        <label>Hvornår? <input type="date" name="dato"></label>
        <button type="submit" class="seen-save">Gem</button>
        <span class="seen-saved" aria-live="polite"></span>
      </form>
    </div>
  </header>
  ${hero}
  <nav class="jump" aria-label="Indhold">${[
    (d.tekst || d.wiki?.extract) && '<a href="#om">Om fuglen</a>',
    PLUMAGE.some((g) => d.photos?.[g.key]?.length) && '<a href="#dragt">Fjerdragt</a>',
    d.gbif && (d.gbif.dkTotal > 0 || d.region === 'verden') && '<a href="#hvornaar">Hvornår</a>',
    d.gbif?.worldTotal && '<a href="#hvor">Hvor</a>',
    d.sound?.src?.length && '<a href="#lyd">Hør den</a>',
  ].filter(Boolean).join('')}</nav>
  ${d.region === 'dk' ? `<section class="block small" id="seneste" data-latest="${esc(d.names.accepted)}" hidden><h2>Seneste fund i Danmark <span class="h2-via">via iNaturalist</span></h2><ol class="latest"></ol><p class="source">Live fra <a href="https://www.inaturalist.org/observations?taxon_name=${encodeURIComponent(d.names.accepted)}&place_id=any&swlat=54.5&swlng=8&nelat=57.8&nelng=15.2" rel="noopener" target="_blank">iNaturalist</a> – observationer delt af brugerne, ikke nødvendigvis godkendt af DOF's Sjældenhedsudvalg. Langt flere danske fund findes i <a href="https://dofbasen.dk/search/" rel="noopener" target="_blank">DOFbasen</a>.</p></section>` : ''}
  ${soundSection(d)}
  ${aboutSection(d)}
  ${plumageSection(d)}
  ${whenSection(d)}
  ${whereSection(d)}
  ${sourcesSection(d)}
</article>`;
}

function metaDescription(d) {
  const name = displayName(d);
  const bits = [];
  if (PLUMAGE.slice(0, 3).some((g) => d.photos?.[g.key]?.length)) bits.push('billeder af han, hun og ungfugl');
  if (d.gbif?.dkTotal >= 20) bits.push('hvornår den ses i Danmark');
  if (d.gbif?.worldTotal) bits.push('kort over hvor den findes');
  const base = `${name} (${d.names.accepted})`;
  const tail = bits.length ? `: ${bits.join(', ')}.` : '.';
  const first = d.tekst?.kendetegn || d.wiki?.extract || '';
  const extra = first ? ` ${first.split(/(?<=\.)\s/)[0]}` : '';
  return clip(base + tail + extra, 158);
}

function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:–-]$/, '') + '…';
}

// ---------------- Sideskabelon ----------------
function page({ title, description, canonical, body, image, type = 'website', noindex = false, jsonld }) {
  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>document.documentElement.classList.add('js')</script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:locale" content="da_DK">
${image ? `<meta property="og:image" content="${esc(image)}">\n<meta name="twitter:card" content="summary_large_image">` : ''}
<meta name="theme-color" content="#f6f5f1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151816" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${url('favicon.svg')}" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(SITE_NAME)}" href="${url('feed.xml')}">
<link rel="preload" href="${url('fonts/fraunces.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${url('fonts/inter.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${url('style.css')}">
<link rel="stylesheet" href="${url('vendor/leaflet.css')}" media="print" onload="this.media='all'">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<header class="site"><div class="site-inner">
  <a class="brand" href="${url('')}"><svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="currentColor"/><path d="M14 38c6-1 10-6 14-12 3-5 8-9 14-9 3 0 6 2 7 5l5 2-5 2c0 9-7 17-18 18-6 1-12-1-17-6z" fill="var(--bg)"/><circle cx="43" cy="22" r="1.8" fill="currentColor"/></svg><span>${esc(SITE_NAME)}</span></a>
  <nav><a href="${url('fugle/')}">Alle fugle</a><a href="${url('arkiv/')}">Tidligere</a><a href="${url('fugle/')}" data-random>Tilfældig</a><a href="${url('mine/')}">Mine fugle</a></nav>
</div></header>
<main>
${body}
</main>
<footer class="site">
  <div class="foot-brand"><strong>${esc(SITE_NAME)}</strong><p>En ny fugl at gætte og lære om hver dag. Billeder, lyde og kort fra åbne kilder – krediteret på hver side. Uden reklamer.</p></div>
  <div class="foot-col"><h4>Fugle</h4><a href="${url('fugle/danske/')}">Danske fugle</a><a href="${url('fugle/udenlandske/')}">Udenlandske fugle</a><a href="${url('maaned/')}">Måned for måned</a><a href="${url('arkiv/')}">Tidligere dage</a></div>
  <div class="foot-col"><h4>Om siden</h4><a href="${url('kilder/')}">Kilder og licenser</a><a href="${url('privatliv/')}">Privatliv</a><a href="${url('mine/')}">Mine fugle</a><a href="${esc(mailto('Feedback til Dagens Fugl'))}">Giv feedback</a></div>
</footer>
<dialog class="lightbox" aria-label="Billede i stor størrelse"><button type="button" class="lb-close" aria-label="Luk">×</button><img alt=""><p class="lb-caption"></p></dialog>
<script>window.DF_BASE=${JSON.stringify(BASE_PATH)};</script>
<script src="${url('vendor/leaflet.js')}" defer></script>
${CF_BEACON ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${esc(CF_BEACON)}"}'></script>` : ''}
<script src="${url('app.js')}" defer></script>
</body>
</html>`;
}

function imageLd(ph) {
  const lic = LICENSES[ph.license];
  const who = ph.attribution ? ph.attribution.replace(/\s*\(c\)\s*/i, '').replace(/, (some|no) rights reserved.*$/i, '').replace(/\s*uploaded by.*$/i, '').trim() : '';
  return {
    '@type': 'ImageObject',
    contentUrl: ph.large || ph.medium,
    ...(lic ? { license: lic.url } : {}),
    acquireLicensePage: ph.source,
    ...(who ? { creditText: who, creator: { '@type': 'Person', name: who }, copyrightNotice: `© ${who}` } : {}),
  };
}

function speciesJsonLd(d, canonical) {
  return [{
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${displayName(d)} (${d.names.accepted})`,
    url: canonical,
    inLanguage: 'da',
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: abs('') },
    about: { '@type': 'Taxon', name: d.names.accepted, alternateName: [d.names.da, d.names.en].filter(Boolean), taxonRank: 'species' },
    ...(d.photos?.hero ? { primaryImageOfPage: imageLd(d.photos.hero) } : {}),
  }, {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME, item: abs('') },
      { '@type': 'ListItem', position: 2, name: d.region === 'dk' ? 'Danske fugle' : 'Udenlandske fugle', item: abs(d.region === 'dk' ? 'fugle/danske/' : 'fugle/udenlandske/') },
      { '@type': 'ListItem', position: 3, name: displayName(d), item: canonical },
    ],
  }];
}

const NAVNE = readJson(path.join(ROOT, 'data', 'navne.json'), {});

// ---------------- Byg ----------------
function main() {
  const list = loadSpeciesList();
  const slugs = readJson(SLUGS_FILE, {});
  const species = [];
  for (const sp of list) {
    const d = readCache(sp.key);
    if (!d) continue;
    d.region = sp.region; // listen bestemmer altid området
    d.tekst = readJson(path.join(ROOT, 'data', 'tekster', `${sp.key}.json`), null);
    if (NAVNE[sp.key]) d.names.da = NAVNE[sp.key];
    const hasContent = d.photos?.hero || d.wiki?.extract;
    if (!hasContent) continue; // ingen tom side
    d.slug = slugs[sp.key] || (d.names.da ? `${slugify(d.names.da)}-${sp.key}` : sp.key);
    species.push(d);
  }
  const byKey = new Map(species.map((d) => [d.key, d]));
  // Dagens fugl skal kunne gættes ud fra både lyd og billede
  const ready = new Set([...byKey.values()].filter((d) => d.sound?.src?.length && d.photos?.hero).map((d) => d.key));
  const schedKeys = list.map((s) => s.key).filter((k) => ready.has(k)); // rækkefølgen laves kun over arter med lyd og billede
  const allKeys = list.map((s) => s.key);

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  copyDir(path.join(ROOT, 'static'), DIST_DIR);

  const today = todayISO(process.env.BUILD_DATE ? new Date(`${process.env.BUILD_DATE}T12:00:00Z`) : new Date());
  const speciesUrl = (d) => `fugle/${d.slug}/`;
  NOW_MONTH = Number(today.slice(5, 7)) - 1;
  EFFORT = Array(12).fill(0);
  for (const d of species) if (d.region === 'dk' && Array.isArray(d.gbif?.dkMonths)) d.gbif.dkMonths.forEach((v, i) => { EFFORT[i] += v; });

  const byGenus = new Map();
  for (const d of species) {
    const g = d.names.accepted.split(' ')[0];
    if (!byGenus.has(g)) byGenus.set(g, []);
    byGenus.get(g).push(d);
  }

  // --- nyt design (v2) som preview under /preview/ – noindex, canonical peger på den rigtige side ---
  const FRAVALGT = new Set(fs.existsSync(path.join(ROOT, 'data', 'fotos-fravalgt.txt'))
    ? fs.readFileSync(path.join(ROOT, 'data', 'fotos-fravalgt.txt'), 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).map(Number) : []);
  const keepPhoto = (ph) => ph && !FRAVALGT.has(ph.id);
  const v2 = makeV2({ esc, url, abs, nf, SITE_NAME, MONTHS, MONTHS_SHORT, regionNames, displayName, size, srcset, credit,
    relMonths, seasonText, rangeText, seasonNow, speciesJsonLd, metaDescription, mailto });
  const byFamily = new Map();
  for (const d of species) { const f = d.taxon?.family; if (f) { if (!byFamily.has(f)) byFamily.set(f, []); byFamily.get(f).push(d); } }
  const family = (d) => {
    const list = d.taxon?.family ? byFamily.get(d.taxon.family) : byGenus.get(d.names.accepted.split(' ')[0]);
    return (list || []).filter((x) => x.region === d.region || d.region !== 'dk').sort((a, b) => (b.gbif?.dkTotal || 0) - (a.gbif?.dkTotal || 0));
  };
  for (const d of species) {
    const dd = { ...d, photos: d.photos && Object.fromEntries(Object.entries(d.photos).map(([k, v]) => [k, Array.isArray(v) ? v.filter(keepPhoto) : keepPhoto(v) ? v : null])) };
    if (dd.photos && !dd.photos.hero) dd.photos.hero = ['male', 'female', 'adult', 'general', 'juvenile'].map((k) => dd.photos[k]?.[0]).find(Boolean) || null;
    write(`preview/${speciesUrl(d)}index.html`, v2.speciesPage(dd, { byKey, family }));
  }
  write('preview/mine/index.html', v2.minePage());

  // --- artssider ---
  for (const d of species) {
    const canonical = abs(speciesUrl(d));
    const name = displayName(d);
    write(`${speciesUrl(d)}index.html`, page({
      title: `${name} (${d.names.accepted}) – fjerdragt, hvor og hvornår | ${SITE_NAME}`,
      description: metaDescription(d),
      canonical,
      image: d.photos?.hero?.large || d.photos?.hero?.medium,
      type: 'article',
      jsonld: speciesJsonLd(d, canonical),
      body: crumbs(d) + speciesBody(d) + related(d) + moreLinks(d) + feedback(d),
    }));
  }

  function feedback(d) {
    const u = abs(speciesUrl(d));
    return `<aside class="feedback"><div><strong>Har du rettelser eller idéer?</strong><span>Ser du en fejl i teksten om ${esc(displayName(d).toLowerCase())}, eller har du et ønske til siden, så skriv gerne.</span></div><a class="button ghost" href="${esc(mailto(`Dagens Fugl: ${displayName(d)}`, `Side: ${u}\n\n`))}">Skriv til os</a></aside>`;
  }

  function crumbs(d) {
    const sec = d.region === 'dk' ? ['fugle/danske/', 'Danske fugle'] : ['fugle/udenlandske/', 'Udenlandske fugle'];
    return `<nav class="crumbs muted" aria-label="Brødkrumme"><a href="${url('')}">${esc(SITE_NAME)}</a> › <a href="${url(sec[0])}">${sec[1]}</a> › ${esc(displayName(d))}</nav>`;
  }

  // Andre arter i samme slægt (eller samme område) – giver Google og læseren noget at gå videre til
  function related(d) {
    const g = d.names.accepted.split(' ')[0];
    const same = (byGenus.get(g) || []).filter((x) => x.key !== d.key).slice(0, 6);
    if (!same.length) return '';
    return `<section class="block" id="beslaegtede"><h2>Beslægtede fugle</h2><p class="lede">Andre arter i slægten <i>${esc(g)}</i>.</p><ul class="cards">${same.map((x) => card(x)).join('')}</ul></section>`;
  }

  function moreLinks(d) {
    return `<aside class="more"><a class="button" href="${url('fugle/')}">Se alle ${species.length} fugle</a><a class="button ghost" href="${url('fugle/')}" data-random>Vis en tilfældig fugl</a></aside>`;
  }

  // --- forside: dagens fugl ---
  // Fast rækkefølge: én art pr. dag fra SCHEDULE_START. Gemmes i data/raekkefoelge.json,
  // så tidligere og kommende dage aldrig ændres – nye arter tilføjes kun i enden.
  const ORDER_FILE = path.join(ROOT, 'data', 'raekkefoelge.json');
  const dayIdx = (iso) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${SCHEDULE_START}T12:00:00Z`)) / 864e5);
  let order = readJson(ORDER_FILE, null)?.dage;
  const before = JSON.stringify(order || null);
  if (!Array.isArray(order) || !order.length) {
    // første gang: gem den rækkefølge, der allerede er blevet vist, og et helt omløb frem
    order = [];
    for (let i = 0; i <= dayIdx(today) + schedKeys.length; i++) order.push(birdForDate(addDays(SCHEDULE_START, i), schedKeys, ready));
  }
  // nye arter (med lyd og billede), der ikke findes efter i dag, sættes ind i enden
  const upcoming = new Set(order.slice(dayIdx(today)));
  const fresh = schedKeys.filter((k) => !upcoming.has(k));
  if (fresh.length) order.push(...permutation(fresh, `nye-${order.length}`));
  // når listen er ved at slippe op, tilføjes et nyt omløb
  let round = 1;
  while (order.length < dayIdx(today) + 60) order.push(...permutation(schedKeys, `omloeb-${order.length}-${round++}`));
  if (JSON.stringify(order) !== before) writeJson(ORDER_FILE, { start: SCHEDULE_START, note: 'Én art pr. dag. Ret aldrig i eksisterende linjer – tilføj kun i enden.', dage: order });
  const birdOn = (iso) => { const k = order[dayIdx(iso)]; return k && byKey.has(k) ? k : null; };

  const todayKey = birdOn(today);
  const recent = [];
  for (let i = 1; i <= 6; i++) {
    const iso = addDays(today, -i);
    const k = birdOn(iso);
    if (k) recent.push({ iso, d: byKey.get(k) });
  }
  let homeBody;
  const todayBird = todayKey ? byKey.get(todayKey) : null;
  if (todayBird) {
    const dayNo = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${SCHEDULE_START}T12:00:00Z`)) / 864e5) + 1;
    const kicker = `<p class="kicker">Dagens fugl · <time datetime="${today}">${esc(capFirst(longDate(today)))}</time></p>`;
    homeBody = quizSection(todayBird, today, dayNo)
      + `<div id="reveal" data-locked data-nosnippet>`
      + speciesBody(todayBird, { kicker, headingTag: 'h2' })
      + `<aside class="more"><a class="button" href="${url(speciesUrl(todayBird))}">Fast link til ${esc(displayName(todayBird))}</a></aside>`
      + `</div>`
      + signupBox()
      + recentStrip(recent);
  } else {
    homeBody = '<article class="species"><h1>Dagens fugl er på vej</h1><p class="big">Data hentes stadig. Kig forbi igen senere.</p></article>';
  }

  // Dagens gætteleg: lyd → lille udsnit → ledetråd → hele billedet
  function quizSection(d, iso, no) {
    const rnd = mulberry32(hashStr(`quiz-opts:${iso}`));
    const pool = species.filter((x) => x.key !== d.key && x.photos?.hero && (d.region === 'dk' ? x.region === 'dk' : x.region !== 'dk'));
    const genus = d.names.accepted.split(' ')[0];
    const same = pool.filter((x) => x.names.accepted.split(' ')[0] === genus);
    const wrong = [];
    for (const x of [...same].sort(() => rnd() - 0.5)) if (wrong.length < 2) wrong.push(x);
    let guard = 0;
    while (wrong.length < 5 && guard++ < 200) { const x = pool[Math.floor(rnd() * pool.length)]; if (!wrong.includes(x)) wrong.push(x); }
    const opts = [d, ...wrong].sort(() => rnd() - 0.5).map((x) => ({ k: x.key, n: displayName(x) }));
    const ph = d.photos?.hero;
    const now = seasonNow(d);
    const hints = [];
    if (d.tekst?.levested) hints.push(`Den lever her: ${d.tekst.levested}`);
    if (d.tekst?.foede) hints.push(`Den spiser: ${d.tekst.foede.charAt(0).toLowerCase()}${d.tekst.foede.slice(1)}`);
    if (d.region === 'dk') {
      hints.push(now ? `I Danmark: ${now.text.charAt(0).toLowerCase()}${now.text.slice(1)}.` : 'Den kan ses i Danmark.');
    } else {
      const lands = (d.gbif?.topCountries || []).filter((c) => c.code && c.code.length === 2 && !/^(XZ|ZZ|AQ)$/.test(c.code)).slice(0, 3)
        .map((c) => { try { return regionNames.of(c.code); } catch { return null; } }).filter((n) => n && !/ukendt/i.test(n));
      hints.push(lands.length ? `Det er en udenlandsk fugl. Flest fund i ${lands.length > 1 ? `${lands.slice(0, -1).join(', ')} og ${lands.at(-1)}` : lands[0]}.` : 'Det er en udenlandsk fugl.');
    }
    // Tre gæt: 1) kun lyden, 2) billedet, 3) fakta
    // Uden egen tekst: brug starten af Wikipedia-teksten, men skjul fuglens navn
    if (!d.tekst && d.wiki?.extract) {
      const names = [d.names.da, d.names.en, d.names.accepted, ...d.names.accepted.split(' ')].filter(Boolean)
        .sort((x, y) => y.length - x.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const mask = new RegExp(`(${names.join('|')})\\p{L}*`, 'giu');
      const sents = d.wiki.extract.split(/(?<=\.)\s+/).slice(0, 2).join(' ').replace(mask, '…');
      if (sents.length > 40) hints.unshift(sents.length > 320 ? `${sents.slice(0, 317)}…` : sents);
    }
    const steps = [];
    if (d.sound?.src?.length) steps.push({ t: 'lyd', label: 'Lyt' });
    if (ph) steps.push({ t: 'billede', label: 'Se billedet', z: 1 });
    steps.push({ t: 'fakta', label: 'Fakta', z: 1 });
    const data = {
      date: iso, no, steps, opts,
      a: Buffer.from(d.key).toString('base64'),
      img: ph ? ph.medium.replace('/medium.', '/large.') : null,
      fx: 35 + Math.floor(rnd() * 30), fy: 35 + Math.floor(rnd() * 30),
      hint: hints.join(' '),
      sound: d.sound ? { src: d.sound.src, credit: `Lyd: ${d.sound.artist || 'ukendt'} · ${d.sound.license} · ${d.sound.via || 'Wikimedia Commons'}`, page: d.sound.page } : null,
      name: displayName(d),
    };
    return `<section class="quiz" id="quiz">
  <p class="kicker">Dagens fugl #${no} · <time datetime="${iso}">${esc(capFirst(longDate(iso)))}</time></p>
  <h1>Hvilken fugl er det?</h1>
  <p class="lede">Tre gæt: først hører du fuglen, så ser du den, og til sidst får du nogle fakta. Når du er færdig, kan du læse alt om den.</p>
  <ol class="quiz-steps" id="quiz-steps"></ol>
  <p class="quiz-step-label" id="quiz-step-label"></p>
  <div class="quiz-stage">
    <div class="quiz-listen" id="quiz-listen" hidden><span class="quiz-listen-icon" aria-hidden="true">🔊</span><audio id="quiz-audio" controls preload="none"></audio><p class="source" id="quiz-audio-credit"></p></div>
    <div class="quiz-frame" id="quiz-frame" hidden><img id="quiz-img" alt="Udsnit af dagens fugl"></div>
    <p class="quiz-hint" id="quiz-hint" hidden></p>
  </div>
  <div class="quiz-opts" id="quiz-opts" role="group" aria-label="Svarmuligheder"></div>
  <p class="quiz-actions"><button type="button" class="linkbtn" id="quiz-skip">Jeg ved det ikke – giv mig næste ledetråd</button></p>
  <div class="quiz-result" id="quiz-result" hidden></div>
  <div class="quiz-stats" id="quiz-stats"></div>
  <script type="application/json" id="quiz-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
</section>`;
  }

  write('index.html', page({
    title: `${SITE_NAME} – gæt dagens fugl`,
    description: 'Hver dag en ny fugl at gætte: lyt til stemmen, se et udsnit af billedet og få ledetråde. Bagefter kan du læse om fjerdragt, sæson og udbredelse.',
    canonical: abs(''),
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: abs(''),
      inLanguage: 'da',
      description: 'Hver dag en ny fugl – danske og udenlandske arter med billeder af fjerdragt, sæson og kort.',
    },
    body: homeBody + `<section class="block small" id="om-siden"><h2>Om Dagens Fugl</h2><p>Hver dag ved midnat skifter siden til en ny fugl. Du får billeder af han, hun og ungfugl, en beskrivelse, hvornår på året den ses i Danmark, og kort over hvor i verden den lever. Der er ${species.length} arter i alt – <a href="${url('fugle/danske/')}">${species.filter((d) => d.region === 'dk').length} danske fugle</a> og <a href="${url('fugle/udenlandske/')}">${species.filter((d) => d.region !== 'dk').length} udenlandske</a>. Vil du vide, hvad du kan møde derude lige nu, så se <a href="${url(`maaned/${MONTH_SLUGS[Number(today.slice(5, 7)) - 1]}/`)}">fugle i ${MONTHS[Number(today.slice(5, 7)) - 1]}</a>.</p></section>`,
  }));

  function recentStrip(items) {
    if (!items.length) return '';
    return `<section class="block" id="seneste"><h2>De seneste dage</h2><ul class="cards">${items.map(({ iso, d }) => card(d, shortDate(iso))).join('')}</ul><p><a href="${url('arkiv/')}">Se flere tidligere fugle</a></p></section>`;
  }

  function card(d, label) {
    const t = thumb(d.photos?.hero);
    return `<li class="card" data-key="${esc(d.key)}" data-region="${d.region}" data-name="${esc(`${displayName(d)} ${d.names.accepted} ${d.names.en || ''}`.toLowerCase())}"><a href="${url(speciesUrl(d))}">${t ? `<img src="${esc(t)}" srcset="${srcset(d.photos.hero, [['small', 240], ['medium', 500]])}" sizes="(min-width: 900px) 220px, 45vw" alt="" loading="lazy" decoding="async">` : '<span class="noimg" aria-hidden="true"></span>'}<span class="card-text">${label ? `<span class="card-label">${esc(label)}</span>` : ''}<span class="card-name">${esc(displayName(d))}</span><i>${esc(d.names.accepted)}</i></span></a></li>`;
  }

  // --- alle fugle ---
  const sorted = [...species].sort((a, b) => displayName(a).localeCompare(displayName(b), 'da'));
  const dkCount = species.filter((d) => d.region === 'dk').length;
  write('fugle/index.html', page({
    title: `Alle fugle – ${species.length} danske og udenlandske arter | ${SITE_NAME}`,
    description: `Oversigt over ${species.length} fuglearter: ${dkCount} danske (på Den danske liste) og ${species.length - dkCount} udenlandske. Med billeder, kort og sæson for hver art.`,
    canonical: abs('fugle/'),
    body: `<section class="listing">
  <h1>Alle fugle</h1>
  <p class="lede">${species.length} arter – <a href="${url('fugle/danske/')}">${dkCount} danske</a> og <a href="${url('fugle/udenlandske/')}">${species.length - dkCount} udenlandske</a>. Danske fugle er arter på Den danske liste. Se også <a href="${url('maaned/')}">hvilke fugle der ses måned for måned</a>.</p>
  <div class="filters" role="search">
    <input type="search" id="q" placeholder="Søg på dansk, engelsk eller latinsk navn" aria-label="Søg efter fugl">
    <div class="seg" role="group" aria-label="Vis">
      <button type="button" data-filter="all" aria-pressed="true">Alle</button>
      <button type="button" data-filter="dk" aria-pressed="false">Danske</button>
      <button type="button" data-filter="verden" aria-pressed="false">Udenlandske</button>
    </div>
  </div>
  <p class="muted" id="count" aria-live="polite"></p>
  <ul class="cards" id="all">${sorted.map((d) => card(d)).join('')}</ul>
</section>`,
  }));

  // --- arkiv (sidste 60 dage) ---
  const arch = [];
  for (let i = 0; i < 60; i++) {
    const iso = addDays(today, -i);
    const k = birdOn(iso);
    if (k) arch.push(card(byKey.get(k), i === 0 ? 'I dag' : shortDate(iso)));
  }
  write('arkiv/index.html', page({
    title: `Tidligere dagens fugle | ${SITE_NAME}`,
    description: 'De seneste 60 dages fugle på Dagens Fugl.',
    canonical: abs('arkiv/'),
    body: `<section class="listing"><h1>Tidligere dagens fugle</h1><p class="lede">De seneste 60 dage.</p><ul class="cards">${arch.join('')}</ul></section>`,
  }));



  const extraUrls = [];
  // Gammel adresse for gættelegen – sender videre til forsiden
  write('gaet/index.html', `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>${esc(SITE_NAME)}</title><link rel="canonical" href="${abs('')}"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${url('')}"></head><body><a href="${url('')}">Gå til Dagens Fugl</a></body></html>`);

  // --- danske og udenlandske fugle (egne sider, så Google kan finde dem) ---
  for (const [slug, region, h1, intro] of [
    ['danske', 'dk', 'Danske fugle', `Oversigt over ${dkCount} danske fuglearter – fra almindelige havefugle til sjældne gæster. Klik på en fugl for billeder af fjerdragten, hvornår den ses, og kort over udbredelsen.`],
    ['udenlandske', 'verden', 'Udenlandske fugle', `${species.length - dkCount} udenlandske fuglearter – fra Afrikas savanner til Sydamerikas regnskove og Antarktis. Klik på en fugl for billeder, beskrivelse og kort over hvor den lever.`],
  ]) {
    const items = sorted.filter((d) => (region === 'dk' ? d.region === 'dk' : d.region !== 'dk'));
    const def = region === 'dk' ? DEF_DANSKE(items) : DEF_UDENLANDSKE();
    write(`fugle/${slug}/index.html`, page({
      title: `${h1} – ${items.length} arter med billeder og kort | ${SITE_NAME}`,
      description: clip(intro, 158),
      canonical: abs(`fugle/${slug}/`),
      jsonld: listLd(h1, items),
      body: `<section class="listing"><h1>${h1}</h1><p class="lede">${esc(intro)}</p>${def}<ul class="cards">${items.map((d) => card(d)).join('')}</ul></section>`,
    }));
    extraUrls.push({ loc: abs(`fugle/${slug}/`), freq: 'weekly' });
  }

  function DEF_DANSKE(items) {
    const rareN = items.filter((d) => (d.gbif?.dkTotal ?? 0) < 20).length;
    return `<aside class="definition"><h2>Hvad er en dansk fugl her?</h2>
<p>En art tæller som dansk på ${esc(SITE_NAME)}, når den står på <strong>Den danske liste</strong>. Det er Dansk Ornitologisk Forenings (DOF) officielle liste over fuglearter, der er truffet vildtlevende i Danmark, og den føres af DOF's Sjældenhedsudvalg (SU).</p>
<p>Listen rummer ynglefugle, trækfugle, vintergæster og sjældne gæster. Den rummer også indførte arter, der har dannet faste, vilde bestande, fx fasan og canadagås. Fugle, der kun er set efter at være undsluppet fra fangenskab, er ikke med.</p>
<p><strong>Sjælden gæst</strong> (${rareN} arter) betyder her, at arten har færre end 20 registreringer fra Danmark i GBIF. Det er en praktisk grænse for denne side og ikke DOF's definition af en SU-art.</p>
<p class="muted">Navne og systematik følger iNaturalist og GBIF og kan afvige en smule fra DOF's navneliste.</p></aside>`;
  }
  function DEF_UDENLANDSKE() { return `<aside class="definition"><h2>Hvad er en udenlandsk fugl her?</h2>
<p>En art tæller som udenlandsk på ${esc(SITE_NAME)}, når den <strong>ikke</strong> står på Den danske liste. Det vil sige, at den aldrig er godkendt som truffet vildtlevende i Danmark.</p>
<p>Nogle få af arterne har alligevel registreringer fra Danmark i GBIF. Det er typisk fugle, der er undsluppet fra fangenskab, og de gør ikke arten dansk.</p></aside>`; }

  function listLd(name, items) {
    return {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name,
      numberOfItems: items.length,
      itemListElement: items.slice(0, 100).map((d, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(speciesUrl(d)), name: displayName(d) })),
    };
  }

  // --- fugle måned for måned ---
  const seasonal = species.filter((d) => d.region === 'dk' && d.gbif?.dkTotal >= 20 && Array.isArray(d.gbif.dkMonths));
  const monthLinks = [];
  for (let m = 0; m < 12; m++) {
    const items = seasonal
      .map((d) => ({ d, share: relMonths(d.gbif.dkMonths)[m], count: d.gbif.dkMonths[m] }))
      .filter((x) => x.share >= 0.4)
      .sort((a, b) => b.count - a.count)
      .map((x) => x.d);
    const peak = seasonal.filter((d) => {
      const mo = relMonths(d.gbif.dkMonths); const mx = 1; const mn = Math.min(...mo);
      return mo[m] === mx && mn < 0.3 * mx; // trækfugle/gæster med top netop denne måned
    });
    const name = MONTHS[m];
    const intro = `${items.length} fugle, der ofte ses i Danmark i ${name}, baseret på registreringer i GBIF og korrigeret for, hvor mange der er ude at kigge efter fugle i hver måned. De mest almindelige står først.`;
    monthLinks.push(`<li><a href="${url(`maaned/${MONTH_SLUGS[m]}/`)}">${capFirst(name)}</a> <span class="muted">(${items.length} arter)</span></li>`);
    write(`maaned/${MONTH_SLUGS[m]}/index.html`, page({
      title: `Fugle i ${name} – hvilke fugle kan man se i Danmark? | ${SITE_NAME}`,
      description: clip(`Hvilke fugle kan du se i Danmark i ${name}? ${items.length} arter med billeder, og hvilke trækfugle og gæster der topper netop nu.`, 158),
      canonical: abs(`maaned/${MONTH_SLUGS[m]}/`),
      jsonld: listLd(`Fugle i Danmark i ${name}`, items),
      body: `<section class="listing">
  <nav class="crumbs muted" aria-label="Brødkrumme"><a href="${url('')}">${esc(SITE_NAME)}</a> › <a href="${url('maaned/')}">Måned for måned</a> › ${capFirst(name)}</nav>
  <h1>Fugle i Danmark i ${name}</h1>
  <p class="lede">${esc(intro)}</p>
  ${peak.length ? `<h2>Topper i ${name}</h2><p class="muted">Fugle, der især ses netop nu – ofte trækfugle eller vintergæster.</p><ul class="cards">${peak.map((d) => card(d)).join('')}</ul><h2>Alle fugle i ${name}</h2>` : ''}
  <ul class="cards">${items.map((d) => card(d)).join('')}</ul>
  <p><a href="${url(`maaned/${MONTH_SLUGS[(m + 11) % 12]}/`)}">← ${capFirst(MONTHS[(m + 11) % 12])}</a> · <a href="${url(`maaned/${MONTH_SLUGS[(m + 1) % 12]}/`)}">${capFirst(MONTHS[(m + 1) % 12])} →</a></p>
</section>`,
    }));
    extraUrls.push({ loc: abs(`maaned/${MONTH_SLUGS[m]}/`), freq: 'monthly' });
  }
  write('maaned/index.html', page({
    title: `Fugle måned for måned – hvornår ses fuglene i Danmark? | ${SITE_NAME}`,
    description: 'Se hvilke fugle der kan ses i Danmark i hver måned af året – fra vintergæster i januar til trækfugle i maj og september.',
    canonical: abs('maaned/'),
    body: `<article class="prose-page"><h1>Fugle måned for måned</h1><p>Fuglelivet i Danmark skifter hen over året. Om vinteren kommer gæster fra nord, om foråret vender trækfuglene hjem, og i sensommeren trækker mange sydpå igen. Vælg en måned og se, hvilke fugle der er gode chancer for at møde.</p><ul class="links">${monthLinks.join('')}</ul></article>`,
  }));
  extraUrls.push({ loc: abs('maaned/'), freq: 'yearly' });

  // --- privatliv ---
  const who = OWNER_NAME ? esc(OWNER_NAME) : `ejeren af ${esc(new URL(SITE_URL).hostname)}`;
  write('privatliv/index.html', page({
    title: `Privatliv og cookies | ${SITE_NAME}`,
    description: 'Dagens Fugl bruger ingen cookies og ingen sporing. Her kan du læse, hvilke tjenester din browser kontakter, når du besøger siden.',
    canonical: abs('privatliv/'),
    body: `<article class="prose-page">
<h1>Privatliv og cookies</h1>
<p><strong>Kort fortalt:</strong> ${esc(SITE_NAME)} sætter ingen cookies, bruger ingen statistik- eller reklameværktøjer og beder dig ikke om nogen oplysninger. Vi gemmer intet om dig.</p>
<h2>Hvem står bag siden?</h2>
<p>Siden drives af ${who}${CONTACT_EMAIL ? `. Har du spørgsmål om privatliv, kan du skrive til <a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a>` : ''}.</p>
<h2>Cookies</h2>
<p>Siden bruger ingen cookies. Derfor er der heller ikke noget cookie-banner. Knappen »Tilfældig« henter blot listen over fugle fra siden selv.</p>
<h2>»Jeg har set den« og Mine fugle</h2>
<p>Når du markerer en fugl som set, gemmes det kun i din egen browser (såkaldt local storage) – det sendes ikke til os eller andre, og vi kan ikke se det. Det bruges kun til at vise din egen liste, fordi du selv har bedt om det. Det samme gælder dine resultater og din stime i »Gæt fuglen«. Du kan slette det hele ved at rydde browserdata for dagensfugl.dk.</p>
<h2>Hvad sker der, når du besøger siden?</h2>
<p>Som på alle hjemmesider sender din browser din IP-adresse og oplysninger om browsertype, når den henter sidens indhold. Det sker hos disse tjenester:</p>
<ul>
<li><strong>GitHub Pages</strong> (GitHub Inc., USA) er sidens webhotel. GitHub registrerer IP-adresser af hensyn til sikkerhed og drift. Se <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" rel="noopener" target="_blank">GitHubs privatlivserklæring</a>.</li>
<li><strong>iNaturalist</strong> (billederne ligger hos Amazon Web Services) leverer fotografierne og de nyeste fund på artssiderne. Se <a href="https://www.inaturalist.org/pages/privacy" rel="noopener" target="_blank">iNaturalists privatlivspolitik</a>.</li>
${CF_BEACON ? `<li><strong>Cloudflare Web Analytics</strong> (Cloudflare Inc., USA) tæller besøg anonymt, så vi kan se hvor mange der bruger siden. Der bruges ingen cookies, og der gemmes intet, der kan genkende dig fra dag til dag.</li>` : ''}
<li><strong>xeno-canto</strong> (Holland) og <strong>Wikimedia Commons</strong> (Wikimedia Foundation, USA) leverer fuglestemmerne. Lyden hentes først, når du trykker afspil.</li>
<li><strong>GBIF</strong> (Global Biodiversity Information Facility, København) leverer kortene og fund fra DOFbasen på artssiderne. Se <a href="https://www.gbif.org/terms/privacy-policy" rel="noopener" target="_blank">GBIFs privatlivspolitik</a>.</li>
</ul>
<p>Oplysningerne bruges kun til at levere indholdet til din skærm. Overførsel til USA sker under EU-USA-rammen for databeskyttelse (Data Privacy Framework), som GitHub og Amazon er tilsluttet.</p>
<h2>Morgenmail og feedback</h2>
<p>Tilmelder du dig morgenmailen, gemmer vi kun din mailadresse og tidspunktet for tilmeldingen – og kun til det formål. Du er først tilmeldt, når du har bekræftet via linket i den første mail. Adresserne ligger i et Google-ark på vores Google-konto og mailen sendes via Google (Gmail). Du kan altid afmelde dig med linket nederst i hver mail, og så sender vi ikke flere. Skriver du til os med feedback, bruger vi kun din mail til at svare dig.</p>
<h2>Dine rettigheder</h2>
<p>Da siden ikke selv gemmer oplysninger om dig, er der ikke noget at indsigte, rette eller slette her. Vil du klage over behandling af personoplysninger, kan du kontakte <a href="https://www.datatilsynet.dk" rel="noopener" target="_blank">Datatilsynet</a>.</p>
<p class="muted">Senest opdateret ${esc(new Intl.DateTimeFormat('da-DK', { dateStyle: 'long' }).format(new Date('2026-11-13T12:00:00Z')))}.</p>
</article>`,
  }));
  extraUrls.push({ loc: abs('privatliv/'), freq: 'yearly' });

  // --- kilder ---
  write('kilder/index.html', page({
    title: `Kilder og licenser | ${SITE_NAME}`,
    description: 'Hvor teksterne, billederne og kortene på Dagens Fugl kommer fra, og hvilke licenser de bruges under.',
    canonical: abs('kilder/'),
    body: `<article class="prose-page">
<h1>Kilder og licenser</h1>
<p>Alt indhold på siden hentes automatisk fra åbne kilder. Hver art har sin egen kildeliste nederst, og hvert foto er krediteret direkte under billedet.</p>
<h2>Billeder – iNaturalist</h2>
<p>Fotos kommer fra <a href="https://www.inaturalist.org" rel="noopener" target="_blank">iNaturalist</a>, hvor fotograferne selv vælger licens. Vi viser kun fotos med licenserne ${ALLOW_NONCOMMERCIAL ? 'CC0, CC BY, CC BY-SA, CC BY-NC og CC BY-NC-SA. Siden er ikke-kommerciel' : 'CC0, CC BY og CC BY-SA, som tillader genbrug med kreditering'}. Fotografens navn, licensen og et link til den oprindelige observation står under hvert billede. Køn og alder (han, hun, ungfugl) er markeret af iNaturalist-brugerne selv og kan i sjældne tilfælde være forkert.</p>
<h2>Tekster</h2>
<p>Mange arter har en beskrivelse skrevet til ${esc(SITE_NAME)} – kendetegn, stemme, levested, føde og forekomst i Danmark. Teksterne er skrevet fra bunden og bygger på almindelig kendt viden om fuglene; de er ikke kopieret fra andre sider. Finder du en fejl, hører vi gerne om det.</p>
<p>For de øvrige arter er beskrivelsen indledningen fra <a href="https://da.wikipedia.org" rel="noopener" target="_blank">dansk Wikipedia</a> – eller engelsk Wikipedia, hvis der ikke findes en dansk artikel. Teksten bruges under <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.da" rel="license noopener" target="_blank">CC BY-SA 4.0</a> med link til artiklen.</p>
<h2>Navne – Wikidata</h2>
<p>Danske og engelske navne kommer fra <a href="https://www.wikidata.org" rel="noopener" target="_blank">Wikidata</a> (CC0) og i enkelte tilfælde fra GBIF.</p>
<h2>Kort og sæson – GBIF</h2>
<p>Kort og fund pr. måned bygger på <a href="https://www.gbif.org" rel="noopener" target="_blank">GBIF – Global Biodiversity Information Facility</a>, som samler registrerede fund fra naturdatabaser og citizen science i hele verden. Tallene viser, hvor og hvornår fuglen er registreret – ikke nødvendigvis hvor mange fugle der er. Baggrundskortene er © <a href="https://www.openstreetmap.org/copyright" rel="noopener" target="_blank">OpenStreetMap</a>-bidragydere og © OpenMapTiles, leveret af GBIF.</p>
<h2>Fuglestemmer – xeno-canto og Wikimedia Commons</h2>
<p>Optagelserne kommer fra <a href="https://xeno-canto.org" rel="noopener" target="_blank">xeno-canto</a> og <a href="https://commons.wikimedia.org" rel="noopener" target="_blank">Wikimedia Commons</a> under Creative Commons-licenser. Optager, licens og link til den oprindelige optagelse står ved hver lyd. Siden er ikke-kommerciel, så vi bruger også optagelser med ikke-kommercielle licenser.</p>
<h2>Kortværktøj</h2>
<p>Kortene vises med <a href="https://leafletjs.com" rel="noopener" target="_blank">Leaflet</a> (BSD-2-licens).</p>
<h2>Fejl og rettelser</h2>
<p>Hvis du finder en fejl, er den bedste vej at rette den hos kilden – fx på Wikipedia eller ved at foreslå en anden artsbestemmelse på iNaturalist. Siden henter opdaterede data løbende.</p>
</article>`,
  }));

  // --- 404 ---
  write('404.html', page({
    title: `Siden findes ikke | ${SITE_NAME}`,
    description: 'Siden findes ikke.',
    canonical: abs('404.html'),
    noindex: true,
    body: `<article class="prose-page"><h1>Den fløj vist væk</h1><p>Siden findes ikke. Prøv <a href="${url('')}">dagens fugl</a> eller <a href="${url('fugle/')}">oversigten over alle fugle</a>.</p></article>`,
  }));

  // --- data til "tilfældig" og søgning ---
  write('fugle.json', JSON.stringify(species.map((d) => url(speciesUrl(d)))));
  write('arter.json', JSON.stringify(sorted.map((d) => ({ k: d.key, n: displayName(d), s: d.names.accepted, r: d.region, u: url(speciesUrl(d)), t: thumb(d.photos?.hero) }))));

  // --- Mine fugle (vises i browseren ud fra det, man selv har markeret) ---
  write('mine/index.html', page({
    title: `Mine fugle | ${SITE_NAME}`,
    description: 'De fugle du har markeret som set på Dagens Fugl.',
    canonical: abs('mine/'),
    noindex: true,
    body: `<section class="listing" id="mine">
  <h1>Mine fugle</h1>
  <p class="lede" id="mine-status">Her samles de fugle, du har markeret med »Jeg har set den«. Listen gemmes kun i din egen browser – vi kan ikke se den.</p>
  <div class="progress" id="mine-progress" hidden aria-hidden="true"><span></span></div>
  <ul class="cards" id="mine-list"></ul>
  <p class="muted">Skifter du browser eller telefon, eller rydder du browserdata, starter listen forfra.</p>
</section>`,
  }));

  // --- sitemap og robots ---
  const urls = [
    { loc: abs(''), freq: 'daily', lastmod: today },
    { loc: abs('fugle/'), freq: 'weekly' },
    { loc: abs('arkiv/'), freq: 'daily', lastmod: today },
    { loc: abs('kilder/'), freq: 'yearly' },
    ...extraUrls,
    ...species.map((d) => ({ loc: abs(speciesUrl(d)), freq: 'monthly', lastmod: d.fetchedAt.slice(0, 10) })),
  ];
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.freq}</changefreq></url>`).join('\n')}\n</urlset>\n`);
  // --- llms.txt: kort oversigt til AI-værktøjer (https://llmstxt.org) ---
  const line = (d) => `- [${displayName(d)} (${d.names.accepted})](${abs(speciesUrl(d))})`;
  write('llms.txt', `# ${SITE_NAME}

> ${SITE_NAME} er en dansk hjemmeside, der hver dag viser en ny fugl. Hver art har sin egen side med egne danske artstekster (med link til Wikipedia), billeder af han, hun og ungfugl (fra iNaturalist, frie licenser), hvornår på året den ses i Danmark og kort over udbredelsen (fra GBIF). Siden dækker ${species.length} arter: ${dkCount} danske (arter på DOF's Den danske liste) og ${species.length - dkCount} udenlandske (ikke på listen).

Alt indhold er på dansk. Kilde og licens står ved hver tekst og hvert billede.

## Oversigter

- [Dagens fugl](${abs('')}): forsiden skifter fugl hver dag ved midnat (dansk tid)
- [Danske fugle](${abs('fugle/danske/')}): arter på DOF's Den danske liste
- [Udenlandske fugle](${abs('fugle/udenlandske/')}): arter, der ikke står på Den danske liste
- [Fugle måned for måned](${abs('maaned/')}): hvilke fugle der ses i Danmark i hver måned
${MONTH_SLUGS.map((m, i) => `- [Fugle i ${MONTHS[i]}](${abs(`maaned/${m}/`)})`).join('\n')}

## Danske fugle

${sorted.filter((d) => d.region === 'dk').map(line).join('\n')}

## Udenlandske fugle

${sorted.filter((d) => d.region !== 'dk').map(line).join('\n')}

## Optional

- [Kilder og licenser](${abs('kilder/')})
- [Privatliv](${abs('privatliv/')})
`);


  // --- mail.json: indholdet til morgenmailen (hentes af Apps Script hver morgen) ---
  {
    const no = dayIdx(today) + 1;
    const yIso = addDays(today, -1);
    const yk = birdOn(yIso);
    const y = yk ? byKey.get(yk) : null;
    const dateTxt = capFirst(longDate(today));
    const yName = y ? displayName(y) : '';
    const yImg = y?.photos?.hero?.medium || '';
    const html = `<!doctype html><html lang="da"><body style="margin:0;background:#f6f5f1;font-family:Arial,sans-serif;color:#1d211f">
<div style="max-width:520px;margin:0 auto;padding:28px 20px">
<p style="margin:0;color:#2e6a4f;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">${esc(SITE_NAME)} #${no} · ${esc(dateTxt)}</p>
<h1 style="font-family:Georgia,serif;font-size:30px;line-height:1.15;margin:8px 0 10px">Hvilken fugl er det i dag?</h1>
<p style="margin:0 0 20px;font-size:16px;line-height:1.55;color:#4b524e">Lyt til stemmen, se billedet og gæt dagens fugl. Tre forsøg – og bagefter kan du læse alt om den.</p>
<p style="margin:0 0 28px"><a href="${abs('')}" style="display:inline-block;background:#2e6a4f;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:99px">Gæt dagens fugl</a></p>
${y ? `<div style="border-top:1px solid #e2e0d8;padding-top:20px"><p style="margin:0 0 10px;font-size:14px;color:#69706b">I går var det …</p>
${yImg ? `<a href="${abs(speciesUrl(y))}"><img src="${esc(yImg)}" alt="${esc(yName)}" width="480" style="width:100%;max-width:480px;border-radius:12px;display:block;margin:0 0 10px"></a>` : ''}
<p style="margin:0;font-family:Georgia,serif;font-size:20px;font-weight:700"><a href="${abs(speciesUrl(y))}" style="color:#1d211f">${esc(yName)}</a></p>
${yImg ? `<p style="margin:4px 0 0;font-size:11px;color:#69706b">Foto: ${esc(String(y.photos.hero.attribution || '').slice(0, 90))} · iNaturalist</p>` : ''}</div>` : ''}
<p style="margin:32px 0 0;font-size:12px;color:#69706b">Du får denne mail, fordi du har tilmeldt dig på dagensfugl.dk. <a href="{{AFMELD}}" style="color:#69706b">Afmeld</a></p>
</div></body></html>`;
    const text = `${SITE_NAME} #${no} – ${dateTxt}\n\nHvilken fugl er det i dag? Gæt den her: ${abs('')}\n${y ? `\nI går var det: ${yName} – ${abs(speciesUrl(y))}\n` : ''}\nAfmeld: {{AFMELD}}`;
    write('mail.json', JSON.stringify({ date: today, no, subject: `Dagens fugl #${no} – kan du gætte den?`, html, text }));
  }

  // --- RSS-feed: dagens fugl (uden at afsløre dagens navn) ---
  {
    const items = [];
    for (let i = 0; i < 14; i++) {
      const iso = addDays(today, -i);
      const k = birdOn(iso);
      if (!k) continue;
      const d = byKey.get(k);
      const no = dayIdx(iso) + 1;
      const pub = new Date(`${iso}T05:00:00Z`).toUTCString();
      if (i === 0) {
        items.push(`<item><title>Dagens fugl #${no} – kan du gætte den?</title><link>${abs('')}</link><guid isPermaLink="false">dagensfugl-${iso}</guid><pubDate>${pub}</pubDate><description>${esc(`Dagens fugl er klar. Lyt til stemmen, se billedet og gæt hvilken fugl det er – ${capFirst(longDate(iso))}.`)}</description></item>`);
      } else {
        items.push(`<item><title>${esc(`Dagens fugl #${no}: ${displayName(d)}`)}</title><link>${abs(speciesUrl(d))}</link><guid isPermaLink="false">dagensfugl-${iso}</guid><pubDate>${pub}</pubDate><description>${esc(d.tekst?.kendetegn || d.wiki?.extract?.split(/(?<=\.)\s/)[0] || '')}</description></item>`);
      }
    }
    write('feed.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(SITE_NAME)}</title><link>${abs('')}</link><description>En ny fugl at gætte hver dag.</description><language>da</language>${items.join('')}</channel></rss>\n`);
  }

  write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /preview/\n\nSitemap: ${abs('sitemap.xml')}\n`);
  write('.nojekyll', '');

  console.log(`Bygget: ${species.length} artssider (${list.length - species.length} mangler stadig data). Dagens fugl ${today}: ${todayBird ? displayName(todayBird) : '–'}`);
}

main();
