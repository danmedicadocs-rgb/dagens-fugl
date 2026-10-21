// Bygger hele den statiske side i dist/ ud fra data/cache.
// Ingen eksterne pakker – kun Node.

import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, DIST_DIR, SLUGS_FILE, loadSpeciesList, readCache, readJson, slugify,
} from './common.mjs';
import {
  SITE_NAME, SITE_URL, BASE_PATH, TIMEZONE, SCHEDULE_START, SCHEDULE_SEED, ALLOW_NONCOMMERCIAL,
} from './config.mjs';

// ---------------- Hjælpere ----------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const url = (p) => `${BASE_PATH}/${p.replace(/^\//, '')}`;
const abs = (p) => `${SITE_URL}/${p.replace(/^\//, '')}`;
const nf = new Intl.NumberFormat('da-DK');
const regionNames = new Intl.DisplayNames(['da'], { type: 'region' });
const MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
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
function displayName(d) { return d.names.da || d.names.en || d.name; }

function thumb(photo) {
  return photo?.medium ? photo.medium.replace('/medium.', '/small.') : null;
}

function credit(photo) {
  const lic = LICENSES[photo.license] || { label: photo.license.toUpperCase(), url: '#' };
  const who = photo.attribution ? esc(photo.attribution.replace(/\s*\(c\)\s*/i, '© ').replace(/, (some|no) rights reserved.*$/i, '').replace(/\s*uploaded by.*$/i, '')) : 'Ukendt fotograf';
  const where = [photo.place, photo.date].filter(Boolean).map(esc).join(', ');
  return `<span class="credit">${who} · <a href="${lic.url}" rel="license noopener" target="_blank">${lic.label}</a> · <a href="${esc(photo.source)}" rel="noopener" target="_blank">iNaturalist</a>${where ? `<span class="where"> · ${where}</span>` : ''}</span>`;
}

function figure(photo, alt, cls = '', eager = false) {
  return `<figure class="${cls}"><img src="${esc(photo.medium)}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"><figcaption>${credit(photo)}</figcaption></figure>`;
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

function aboutSection(d) {
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

function monthChart(months) {
  const max = Math.max(...months, 1);
  const W = 600; const H = 180; const pad = 24; const bw = (W - 8) / 12;
  const bars = months.map((v, i) => {
    const h = Math.max(v > 0 ? 2 : 0, Math.round((v / max) * (H - pad - 10)));
    return `<g><title>${capFirst(MONTHS[i])}: ${nf.format(v)} fund</title><rect x="${(4 + i * bw + 4).toFixed(1)}" y="${H - pad - h}" width="${(bw - 8).toFixed(1)}" height="${h}" rx="3" class="bar"/><text x="${(4 + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="axis">${MONTHS_SHORT[i]}</text></g>`;
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
  <p class="big">${esc(seasonText(g.dkMonths))}</p>
  ${monthChart(g.dkMonths)}
  <p class="muted">Baseret på ${nf.format(g.dkTotal)} registrerede fund i Danmark.</p>
  ${src}
</section>`;
  }
  if (g.dkTotal > 0) {
    return `<section class="block" id="hvornaar">
  <h2>Ses den i Danmark?</h2>
  <p class="big">Den er en sjælden gæst – der er kun ${nf.format(g.dkTotal)} registrerede fund i Danmark.</p>
  ${src}
</section>`;
  }
  if (d.region === 'verden') {
    return `<section class="block" id="hvornaar">
  <h2>Ses den i Danmark?</h2>
  <p class="big">Der er ingen registrerede fund af vildtlevende fugle i Danmark.</p>
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

function speciesBody(d, { headingTag = 'h1', kicker = '' } = {}) {
  const name = displayName(d);
  const alt = d.names.da && d.names.en ? `<span class="alt">${esc(d.names.en)}</span>` : '';
  const tag = d.region === 'dk' ? '<span class="tag">Ses i Danmark</span>' : '<span class="tag">Udenlandsk fugl</span>';
  const hero = d.photos?.hero ? figure(d.photos.hero, name, 'hero', true) : '';
  return `<article class="species">
  <header class="species-head">
    ${kicker}
    <${headingTag}>${esc(name)}</${headingTag}>
    <p class="sci"><i>${esc(d.names.accepted)}</i>${alt}${tag}</p>
  </header>
  ${hero}
  <nav class="jump" aria-label="Indhold">${[
    d.wiki?.extract && '<a href="#om">Om fuglen</a>',
    PLUMAGE.some((g) => d.photos?.[g.key]?.length) && '<a href="#dragt">Fjerdragt</a>',
    d.gbif && (d.gbif.dkTotal > 0 || d.region === 'verden') && '<a href="#hvornaar">Hvornår</a>',
    d.gbif?.worldTotal && '<a href="#hvor">Hvor</a>',
  ].filter(Boolean).join('')}</nav>
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
  const extra = d.wiki?.extract ? ` ${d.wiki.extract.split(/(?<=\.)\s/)[0]}` : '';
  return (base + tail + extra).slice(0, 300);
}

// ---------------- Sideskabelon ----------------
function page({ title, description, canonical, body, image, type = 'website', noindex = false, jsonld }) {
  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
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
<link rel="stylesheet" href="${url('style.css')}">
<link rel="stylesheet" href="${url('vendor/leaflet.css')}" media="print" onload="this.media='all'">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<header class="site">
  <a class="brand" href="${url('')}">${esc(SITE_NAME)}</a>
  <nav><a href="${url('fugle/')}">Alle fugle</a><a href="${url('arkiv/')}">Tidligere</a><a href="${url('fugle/')}" data-random>Tilfældig</a></nav>
</header>
<main>
${body}
</main>
<footer class="site">
  <p>${esc(SITE_NAME)} viser en ny fugl hver dag. Tekster, billeder og kort hentes fra åbne kilder og krediteres på hver side.</p>
  <p><a href="${url('kilder/')}">Kilder og licenser</a> · <a href="${url('fugle/')}">Alle fugle</a></p>
</footer>
<script>window.DF_BASE=${JSON.stringify(BASE_PATH)};</script>
<script src="${url('vendor/leaflet.js')}" defer></script>
<script src="${url('app.js')}" defer></script>
</body>
</html>`;
}

function speciesJsonLd(d, canonical) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: displayName(d),
    url: canonical,
    inLanguage: 'da',
    about: { '@type': 'Taxon', name: d.names.accepted, alternateName: [d.names.da, d.names.en].filter(Boolean), taxonRank: 'species' },
    ...(d.photos?.hero ? { primaryImageOfPage: { '@type': 'ImageObject', contentUrl: d.photos.hero.large || d.photos.hero.medium, creditText: d.photos.hero.attribution, license: LICENSES[d.photos.hero.license]?.url } } : {}),
  };
}

// ---------------- Byg ----------------
function main() {
  const list = loadSpeciesList();
  const slugs = readJson(SLUGS_FILE, {});
  const species = [];
  for (const sp of list) {
    const d = readCache(sp.key);
    if (!d) continue;
    d.region = sp.region; // listen bestemmer altid området
    const hasContent = d.photos?.hero || d.wiki?.extract;
    if (!hasContent) continue; // ingen tom side
    d.slug = slugs[sp.key] || (d.names.da ? `${slugify(d.names.da)}-${sp.key}` : sp.key);
    species.push(d);
  }
  const byKey = new Map(species.map((d) => [d.key, d]));
  const ready = new Set(byKey.keys());
  const allKeys = list.map((s) => s.key);

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  copyDir(path.join(ROOT, 'static'), DIST_DIR);

  const today = todayISO(process.env.BUILD_DATE ? new Date(`${process.env.BUILD_DATE}T12:00:00Z`) : new Date());
  const speciesUrl = (d) => `fugle/${d.slug}/`;

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
      body: speciesBody(d) + moreLinks(d),
    }));
  }

  function moreLinks(d) {
    return `<aside class="more"><a class="button" href="${url('fugle/')}">Se alle ${species.length} fugle</a><a class="button ghost" href="${url('fugle/')}" data-random>Vis en tilfældig fugl</a></aside>`;
  }

  // --- forside: dagens fugl ---
  const todayKey = birdForDate(today, allKeys, ready);
  const recent = [];
  for (let i = 1; i <= 6; i++) {
    const iso = addDays(today, -i);
    const k = birdForDate(iso, allKeys, ready);
    if (k) recent.push({ iso, d: byKey.get(k) });
  }
  let homeBody;
  const todayBird = todayKey ? byKey.get(todayKey) : null;
  if (todayBird) {
    const kicker = `<p class="kicker">Dagens fugl · <time datetime="${today}">${esc(capFirst(longDate(today)))}</time></p>`;
    homeBody = speciesBody(todayBird, { kicker })
      + `<aside class="more"><a class="button" href="${url(speciesUrl(todayBird))}">Fast link til ${esc(displayName(todayBird))}</a></aside>`
      + recentStrip(recent);
  } else {
    homeBody = '<article class="species"><h1>Dagens fugl er på vej</h1><p class="big">Data hentes stadig. Kig forbi igen senere.</p></article>';
  }
  write('index.html', page({
    title: todayBird ? `Dagens fugl: ${displayName(todayBird)} | ${SITE_NAME}` : SITE_NAME,
    description: todayBird
      ? `Dagens fugl er ${displayName(todayBird)}. Hver dag en ny fugl med billeder af fjerdragt, hvornår og hvor du kan se den, og kort over udbredelsen.`
      : 'Hver dag en ny fugl – danske og udenlandske – med billeder, kort og sæson.',
    canonical: abs(''),
    image: todayBird?.photos?.hero?.large,
    body: homeBody,
  }));

  function recentStrip(items) {
    if (!items.length) return '';
    return `<section class="block" id="seneste"><h2>De seneste dage</h2><ul class="cards">${items.map(({ iso, d }) => card(d, shortDate(iso))).join('')}</ul><p><a href="${url('arkiv/')}">Se flere tidligere fugle</a></p></section>`;
  }

  function card(d, label) {
    const t = thumb(d.photos?.hero);
    return `<li class="card" data-region="${d.region}" data-name="${esc(`${displayName(d)} ${d.names.accepted} ${d.names.en || ''}`.toLowerCase())}"><a href="${url(speciesUrl(d))}">${t ? `<img src="${esc(t)}" alt="" loading="lazy" decoding="async">` : '<span class="noimg" aria-hidden="true"></span>'}<span class="card-text">${label ? `<span class="card-label">${esc(label)}</span>` : ''}<span class="card-name">${esc(displayName(d))}</span><i>${esc(d.names.accepted)}</i></span></a></li>`;
  }

  // --- alle fugle ---
  const sorted = [...species].sort((a, b) => displayName(a).localeCompare(displayName(b), 'da'));
  const dkCount = species.filter((d) => d.region === 'dk').length;
  write('fugle/index.html', page({
    title: `Alle fugle – ${species.length} danske og udenlandske arter | ${SITE_NAME}`,
    description: `Oversigt over ${species.length} fuglearter: ${dkCount} der ses i Danmark og ${species.length - dkCount} udenlandske. Med billeder, kort og sæson for hver art.`,
    canonical: abs('fugle/'),
    body: `<section class="listing">
  <h1>Alle fugle</h1>
  <p class="lede">${species.length} arter – ${dkCount} der ses i Danmark og ${species.length - dkCount} fra resten af verden.</p>
  <div class="filters" role="search">
    <input type="search" id="q" placeholder="Søg på dansk, engelsk eller latinsk navn" aria-label="Søg efter fugl">
    <div class="seg" role="group" aria-label="Vis">
      <button type="button" data-filter="all" aria-pressed="true">Alle</button>
      <button type="button" data-filter="dk" aria-pressed="false">I Danmark</button>
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
    const k = birdForDate(iso, allKeys, ready);
    if (k) arch.push(card(byKey.get(k), i === 0 ? 'I dag' : shortDate(iso)));
  }
  write('arkiv/index.html', page({
    title: `Tidligere dagens fugle | ${SITE_NAME}`,
    description: 'De seneste 60 dages fugle på Dagens Fugl.',
    canonical: abs('arkiv/'),
    body: `<section class="listing"><h1>Tidligere dagens fugle</h1><p class="lede">De seneste 60 dage.</p><ul class="cards">${arch.join('')}</ul></section>`,
  }));

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
<h2>Tekster – Wikipedia</h2>
<p>Beskrivelserne er indledningen fra <a href="https://da.wikipedia.org" rel="noopener" target="_blank">dansk Wikipedia</a> – eller engelsk Wikipedia, hvis der ikke findes en dansk artikel. Teksten bruges under <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.da" rel="license noopener" target="_blank">CC BY-SA 4.0</a> med link til artiklen.</p>
<h2>Navne – Wikidata</h2>
<p>Danske og engelske navne kommer fra <a href="https://www.wikidata.org" rel="noopener" target="_blank">Wikidata</a> (CC0) og i enkelte tilfælde fra GBIF.</p>
<h2>Kort og sæson – GBIF</h2>
<p>Kort og fund pr. måned bygger på <a href="https://www.gbif.org" rel="noopener" target="_blank">GBIF – Global Biodiversity Information Facility</a>, som samler registrerede fund fra naturdatabaser og citizen science i hele verden. Tallene viser, hvor og hvornår fuglen er registreret – ikke nødvendigvis hvor mange fugle der er. Baggrundskortene er © <a href="https://www.openstreetmap.org/copyright" rel="noopener" target="_blank">OpenStreetMap</a>-bidragydere og © OpenMapTiles, leveret af GBIF.</p>
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

  // --- sitemap og robots ---
  const urls = [
    { loc: abs(''), freq: 'daily', lastmod: today },
    { loc: abs('fugle/'), freq: 'weekly' },
    { loc: abs('arkiv/'), freq: 'daily', lastmod: today },
    { loc: abs('kilder/'), freq: 'yearly' },
    ...species.map((d) => ({ loc: abs(speciesUrl(d)), freq: 'monthly', lastmod: d.fetchedAt.slice(0, 10) })),
  ];
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.freq}</changefreq></url>`).join('\n')}\n</urlset>\n`);
  write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${abs('sitemap.xml')}\n`);
  write('.nojekyll', '');

  console.log(`Bygget: ${species.length} artssider (${list.length - species.length} mangler stadig data). Dagens fugl ${today}: ${todayBird ? displayName(todayBird) : '–'}`);
}

main();
