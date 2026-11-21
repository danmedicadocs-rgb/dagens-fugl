// Henter data om hver art fra åbne kilder og gemmer dem i data/cache/<art>.json.
// Kører i GitHub Actions. Kun arter uden data, eller med data ældre end REFRESH_DAYS,
// hentes – højst MAX_FETCH pr. kørsel, så vi er flinke ved kilderne.
//
// Kilder:
//   Wikidata     – dansk/engelsk navn, links til Wikipedia, GBIF og iNaturalist (CC0)
//   Wikipedia    – kort beskrivelse (CC BY-SA 4.0, kreditering påkrævet)
//   iNaturalist  – fotos med køn/alder-markering (kun fotos med fri licens, krediteres)
//   GBIF         – antal fund pr. måned i Danmark, lande med flest fund, kort-fliser

import fs from 'node:fs';
import path from 'node:path';
import {
  loadSpeciesList, readCache, writeJson, cachePath, readJson, sleep,
  CACHE_DIR, SLUGS_FILE, slugify, ROOT,
} from './common.mjs';
import { USER_AGENT, MAX_FETCH, REFRESH_DAYS, PHOTO_LICENSES } from './config.mjs';

const HEADERS = { 'User-Agent': USER_AGENT, 'Accept': 'application/json', 'Api-User-Agent': USER_AGENT };

// Minimum pause mellem kald pr. vært (ms). iNaturalist beder om højst ca. 1 kald i sekundet.
const HOST_DELAY = { 'api.inaturalist.org': 1100, 'xeno-canto.org': 1000, default: 250 };
const lastCall = new Map();

async function getJson(url, { allow404 = false } = {}) {
  const host = new URL(url).host;
  const delay = HOST_DELAY[host] ?? HOST_DELAY.default;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const wait = (lastCall.get(host) || 0) + delay - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall.set(host, Date.now());
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25000) });
      if (res.status === 404 && allow404) return null;
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      return await res.json();
    } catch (err) {
      if (err.fatal || attempt === 4) throw new Error(`${err.message} – ${url}`);
      await sleep(2000 * attempt * attempt);
    }
  }
}

const q = encodeURIComponent;

// ---------- Wikidata ----------
async function wikidata(sciName) {
  const s = await getJson(`https://www.wikidata.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=${q(`haswbstatement:"P225=${sciName}"`)}`);
  const hits = s?.query?.search || [];
  if (!hits.length) return null;
  const ids = hits.map((h) => h.title).join('|');
  const e = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|sitelinks|claims&languages=da|en&sitefilter=dawiki|enwiki&ids=${q(ids)}`);
  const entities = Object.values(e?.entities || {});
  // Foretræk en entitet hvis taxonnavn præcist matcher og som er en art.
  const claimStr = (ent, p) => ent.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;
  const ent = entities.find((x) => claimStr(x, 'P225') === sciName) || entities[0];
  if (!ent) return null;
  return {
    id: ent.id,
    labelDa: ent.labels?.da?.value || null,
    labelEn: ent.labels?.en?.value || null,
    dawiki: ent.sitelinks?.dawiki?.title || null,
    enwiki: ent.sitelinks?.enwiki?.title || null,
    gbif: claimStr(ent, 'P846') || null,
    inat: claimStr(ent, 'P3151') || null,
  };
}

// ---------- Wikipedia ----------
async function wikipedia(lang, title) {
  if (!title) return null;
  const d = await getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${q(title.replace(/ /g, '_'))}`, { allow404: true });
  if (!d || d.type === 'disambiguation' || !d.extract) return null;
  return {
    lang,
    title: d.title,
    extract: d.extract.trim(),
    url: d.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${q(title)}`,
  };
}

// ---------- iNaturalist ----------
async function inatTaxon(sciName, inatId) {
  // Følg iNaturalists taksonomiske ændringer: et inaktivt (udskiftet) takson peger på sin afløser.
  // Ved opdelinger findes flere afløsere: vælg den med samme artsnavn (stamme, så »rustica« matcher »rusticus«).
  // Er der ingen med samme artsnavn (fx når arten er slået sammen med en anden), følges ændringen ikke.
  const stem = (n) => String(n || '').split(' ').pop().toLowerCase().slice(0, 5);
  const follow = async (t, depth = 0) => {
    if (!t || t.is_active !== false || depth > 2) return t;
    const ids = t.current_synonymous_taxon_ids || [];
    if (!ids.length) return t;
    const d = await getJson(`https://api.inaturalist.org/v1/taxa/${ids.slice(0, 10).join(',')}?locale=da`, { allow404: true });
    const want = stem(sciName);
    const next = (d?.results || []).find((x) => stem(x.name) === want);
    return next ? follow(next, depth + 1) : t;
  };
  if (inatId) {
    const d = await getJson(`https://api.inaturalist.org/v1/taxa/${inatId}?locale=da`, { allow404: true });
    if (d?.results?.[0]) return follow(d.results[0]);
  }
  const d = await getJson(`https://api.inaturalist.org/v1/taxa?q=${q(sciName)}&rank=species&locale=da&per_page=10`);
  const res = d?.results || [];
  const hit = res.find((t) => t.name === sciName && t.is_active !== false)
    || res.find((t) => t.name === sciName)
    || res.find((t) => (t.matched_term || '').toLowerCase() === sciName.toLowerCase())
    || null;
  return follow(hit);
}

function photoSize(url, size) {
  return url ? url.replace(/\/(square|small|medium|large|original|thumb)\.(jpe?g|png|gif)/i, `/${size}.$2`) : null;
}

function cleanPhoto(p, obs) {
  if (!p?.url || !p.license_code) return null;
  const lic = p.license_code.toLowerCase();
  if (!PHOTO_LICENSES.includes(lic)) return null;
  return {
    id: p.id,
    medium: photoSize(p.url, 'medium'),
    large: photoSize(p.url, 'large'),
    attribution: p.attribution || null,
    license: lic,
    source: obs ? `https://www.inaturalist.org/observations/${obs.id}` : `https://www.inaturalist.org/photos/${p.id}`,
    place: obs?.place_guess || null,
    date: obs?.observed_on || null,
  };
}

// term_id 9 = køn (10 hun, 11 han); term_id 1 = livsstadie (2 voksen, 8 ung)
const CATEGORIES = [
  { key: 'male', term: 9, value: 11 },
  { key: 'female', term: 9, value: 10 },
  { key: 'juvenile', term: 1, value: 8 },
  { key: 'adult', term: 1, value: 2 },
  { key: 'general', term: null, value: null },
];

async function inatPhotos(taxonId, seen) {
  const out = {};
  for (const c of CATEGORIES) {
    if (c.key === 'adult' && (out.male?.length || out.female?.length)) continue;
    if (c.key === 'general' && Object.values(out).some((a) => a.length)) continue;
    const ann = c.term ? `&term_id=${c.term}&term_value_id=${c.value}` : '';
    const d = await getJson(`https://api.inaturalist.org/v1/observations?taxon_id=${taxonId}${ann}&photo_license=${PHOTO_LICENSES.join(',')}&quality_grade=research&photos=true&order_by=votes&order=desc&per_page=12`);
    const list = [];
    for (const obs of d?.results || []) {
      if (obs.taxon && obs.taxon.id !== taxonId && !obs.taxon.ancestor_ids?.includes(taxonId)) continue;
      for (const p of obs.photos || []) {
        const ph = cleanPhoto(p, obs);
        if (ph && !seen.has(ph.id)) { seen.add(ph.id); list.push(ph); break; } // ét foto pr. observation
      }
      if (list.length >= 3) break;
    }
    out[c.key] = list;
  }
  return out;
}

// ---------- Lyd fra Wikimedia Commons ----------
// Mange fuglestemmer fra xeno-canto er lagt på Commons under frie licenser (ingen API-nøgle nødvendig).
const SOUND_LICENSE = /^(cc0|public domain|cc by(-sa)? [0-9.]+)$/i;
const stripHtml = (h) => String(h || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function commonsSound(sciName) {
  const search = `"${sciName}" filetype:audio`;
  const d = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&generator=search&gsrnamespace=6&gsrlimit=10&gsrsearch=${q(search)}&prop=videoinfo&viprop=url|mime|extmetadata|derivatives`);
  const pages = (d?.query?.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0));
  const name = sciName.toLowerCase();
  const scored = [];
  for (const pg of pages) {
    const info = pg.videoinfo?.[0];
    if (!info) continue;
    const title = (pg.title || '').toLowerCase();
    if (!title.includes(name)) continue; // skal handle om netop denne art
    const meta = info.extmetadata || {};
    const lic = stripHtml(meta.LicenseShortName?.value);
    if (!SOUND_LICENSE.test(lic)) continue;
    const src = [];
    for (const dv of info.derivatives || []) {
      if (/mpeg|mp3/i.test(dv.type || '') && dv.src) src.push({ u: dv.src, type: 'audio/mpeg' });
    }
    if (info.url) src.push({ u: info.url, type: info.mime || '' });
    if (!src.length) continue;
    // sang foretrækkes frem for kald
    const score = (/song|sang/.test(title) ? 2 : 0) + (/call|kald|alarm/.test(title) ? 0 : 1);
    scored.push({ score, s: {
      src,
      license: lic,
      licenseUrl: stripHtml(meta.LicenseUrl?.value) || null,
      artist: stripHtml(meta.Artist?.value).slice(0, 120) || null,
      page: info.descriptionurl || `https://commons.wikimedia.org/wiki/${q(pg.title)}`,
    } });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.s || null;
}
// ---------- Lyd fra xeno-canto (kræver gratis API-nøgle i XC_KEY) ----------
const XC_KEY = process.env.XC_KEY || '';
const NEAR = new Set(['Denmark', 'Sweden', 'Norway', 'Germany', 'Netherlands', 'Poland', 'Finland', 'United Kingdom', 'Belgium', 'France', 'Estonia', 'Latvia', 'Lithuania']);
function xcLicense(u) {
  const m = String(u || '').match(/licenses\/([a-z-]+)\/([0-9.]+)/i);
  if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
  if (/publicdomain|zero/i.test(u || '')) return 'CC0';
  return null;
}
const secs = (t) => { const p = String(t || '').split(':').map(Number); return p.length === 2 ? p[0] * 60 + p[1] : NaN; };

async function xenoCantoSound(sciName, region) {
  if (!XC_KEY) return undefined; // ingen nøgle → spring over
  let recs = [];
  for (const query of [`sp:"${sciName}" q:A`, `sp:"${sciName}"`]) {
    const d = await getJson(`https://xeno-canto.org/api/3/recordings?query=${q(query)}&per_page=100&key=${q(XC_KEY)}`, { allow404: true });
    recs = d?.recordings || [];
    if (recs.length) break;
  }
  const scored = recs
    .filter((r) => r.file && xcLicense(r.lic))
    .map((r) => {
      const len = secs(r.length);
      const type = String(r.type || '').toLowerCase();
      let score = 0;
      if (/song/.test(type)) score += 3;
      if (r.q === 'A') score += 2; else if (r.q === 'B') score += 1;
      if (len >= 8 && len <= 60) score += 2; else if (len > 60 && len <= 120) score += 1;
      if (region === 'dk' && NEAR.has(r.cnt)) score += 1;
      if (/background|bg:/.test(String(r.also || ''))) score -= 0;
      return { r, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.r;
  if (!best) return null;
  const file = best.file.startsWith('//') ? `https:${best.file}` : best.file;
  return {
    src: [{ u: file, type: 'audio/mpeg' }],
    license: xcLicense(best.lic),
    licenseUrl: best.lic?.startsWith('//') ? `https:${best.lic}` : best.lic || null,
    artist: best.rec || null,
    page: `https://xeno-canto.org/${best.id}`,
    type: best.type || null,
    via: 'xeno-canto',
  };
}

async function findSound(sciName, region) {
  let s;
  try { s = await xenoCantoSound(sciName, region); } catch (e) { s = undefined; console.log(`    xeno-canto ${sciName}: ${e.message}`); }
  if (s) return s;
  const c = await commonsSound(sciName);
  return c ? { ...c, via: 'Wikimedia Commons' } : null;
}
const SOUND_VERSION = XC_KEY ? 2 : 1;

// ---------- GBIF ----------
async function gbifKey(sciName, fromWikidata, altName) {
  // Saml kandidater (Wikidata, navnet i listen og iNaturalists nuværende navn) og vælg den med flest fund.
  // Det fanger arter, der er flyttet til en ny slægt, hvor fundene nu ligger under det nye navn.
  const cands = new Set();
  if (fromWikidata) {
    const sp = await getJson(`https://api.gbif.org/v1/species/${fromWikidata}`, { allow404: true });
    if (sp?.key) cands.add(sp.acceptedKey || sp.key);
  }
  for (const n of [sciName, altName].filter(Boolean)) {
    const m = await getJson(`https://api.gbif.org/v1/species/match?name=${q(n)}&kingdom=Animalia&class=Aves`);
    // Kun match på artsniveau – et slægtsmatch ville give alle slægtens fund.
    if (m && m.usageKey && m.matchType !== 'NONE' && m.matchType !== 'HIGHERRANK' && (m.rank === 'SPECIES' || m.rank === 'SUBSPECIES')) cands.add(m.acceptedUsageKey || m.usageKey);
  }
  const list = [...cands];
  if (list.length < 2) return list[0] || null;
  let best = null; let bestN = -1;
  for (const k of list) {
    const c = await getJson(`https://api.gbif.org/v1/occurrence/search?taxonKey=${k}&limit=0`);
    if ((c?.count || 0) > bestN) { bestN = c?.count || 0; best = k; }
  }
  return best;
}

async function gbifStats(key) {
  const base = `https://api.gbif.org/v1/occurrence/search?taxonKey=${key}&occurrenceStatus=PRESENT&limit=0`;
  const dk = await getJson(`${base}&country=DK&facet=month&facetLimit=12`);
  const months = Array(12).fill(0);
  for (const c of dk?.facets?.find((f) => f.field === 'MONTH')?.counts || []) {
    const i = Number(c.name) - 1;
    if (i >= 0 && i < 12) months[i] = c.count;
  }
  const world = await getJson(`${base}&facet=country&facetLimit=12`);
  const countries = (world?.facets?.find((f) => f.field === 'COUNTRY')?.counts || [])
    .map((c) => ({ code: c.name, count: c.count }));
  return { dkTotal: dk?.count || 0, dkMonths: months, worldTotal: world?.count || 0, topCountries: countries };
}

async function gbifDanishName(key) {
  const d = await getJson(`https://api.gbif.org/v1/species/${key}/vernacularNames?limit=200`, { allow404: true });
  const hit = (d?.results || []).find((v) => v.language === 'dan' && v.vernacularName);
  return hit?.vernacularName || null;
}

// ---------- Saml én art ----------
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function isRealName(label, sci) { return label && label.toLowerCase() !== sci.toLowerCase(); }

async function fetchSpecies(sp, old) {
  const warn = [];
  const step = async (label, fn) => { try { return await fn(); } catch (e) { warn.push(`${label}: ${e.message}`); return undefined; } };

  const wd = await step('wikidata', () => wikidata(sp.name));
  const taxon = await step('inaturalist taxon', () => inatTaxon(sp.name, wd?.inat));
  const gKey = await step('gbif match', () => gbifKey(sp.name, wd?.gbif, taxon?.name !== sp.name ? taxon?.name : null));

  let da = isRealName(wd?.labelDa, sp.name) ? cap(wd.labelDa) : null;
  if (!da && gKey) da = cap(await step('gbif navn', () => gbifDanishName(gKey)) || '') || null;
  const en = isRealName(wd?.labelEn, sp.name) ? cap(wd.labelEn) : null;

  let wiki = await step('wikipedia da', () => wikipedia('da', wd?.dawiki));
  if (!wiki || wiki.extract.length < 80) {
    const enWiki = await step('wikipedia en', () => wikipedia('en', wd?.enwiki));
    if (enWiki && (!wiki || enWiki.extract.length > wiki.extract.length * 2)) wiki = enWiki;
  }

  let photos;
  if (taxon?.id) {
    const seen = new Set();
    photos = await step('inaturalist fotos', () => inatPhotos(taxon.id, seen));
    // iNaturalists egne udvalgte artsfotos (taxon_photos) er som regel de skarpeste og bedste.
    let full = taxon;
    if (!Array.isArray(taxon.taxon_photos)) {
      full = (await step('inaturalist artsfotos', () => getJson(`https://api.inaturalist.org/v1/taxa/${taxon.id}?locale=da`, { allow404: true })))?.results?.[0] || taxon;
    }
    const curated = [taxon.default_photo, ...(full.taxon_photos || []).map((tp) => tp.photo)];
    const hero = curated.map((p) => cleanPhoto(p, null)).find(Boolean) || null;
    if (photos) photos.hero = hero || photos.male?.[0] || photos.adult?.[0] || photos.general?.[0] || photos.female?.[0] || null;
  }

  const gbif = gKey ? await step('gbif statistik', () => gbifStats(gKey)) : undefined;
  const sound = await step('lyd', () => findSound(taxon?.name || sp.name, sp.region));

  // Hvis et trin fejlede, behold de gamle data for netop det felt.
  const keep = (val, oldVal) => (val === undefined ? (oldVal ?? null) : val);
  return {
    key: sp.key,
    name: sp.name,
    region: sp.region,
    fetchedAt: new Date().toISOString(),
    names: { da: da || old?.names?.da || null, en: en || old?.names?.en || null, accepted: taxon?.name || old?.names?.accepted || sp.name },
    wikidata: wd ? { id: wd.id } : old?.wikidata || null,
    wiki: keep(wiki, old?.wiki),
    inat: taxon ? { id: taxon.id, observations: taxon.observations_count || 0 } : old?.inat || null,
    photos: keep(photos, old?.photos),
    gbif: gbif ? { key: gKey, ...gbif } : old?.gbif || null,
    sound: sound === undefined ? (old?.sound ?? null) : sound,
    soundVersion: SOUND_VERSION,
    photoVersion: PHOTO_VERSION,
    refetchedFor: REFETCH[sp.key] || old?.refetchedFor || null,
    warnings: warn,
  };
}

// data/hent-igen.txt: »nøgle dato« – arten hentes forfra én gang (fx efter taksonomiske ændringer).
const REFETCH = Object.fromEntries((fs.existsSync(path.join(ROOT, 'data', 'hent-igen.txt')) ? fs.readFileSync(path.join(ROOT, 'data', 'hent-igen.txt'), 'utf8') : '')
  .split('\n').map((l) => l.replace(/#.*/, '').trim().split(/\s+/)).filter((a) => a.length === 2));

// Hæves når måden at vælge billeder på ændres – så hentes alle arter igen ved næste fulde kørsel.
const PHOTO_VERSION = 3; // 3: også billeder med ikke-kommerciel licens

// ---------- Hovedløkke ----------
async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const list = loadSpeciesList();
  const slugs = readJson(SLUGS_FILE, {});
  const now = Date.now();
  const due = list
    .map((sp) => ({ sp, old: readCache(sp.key) }))
    .filter(({ sp, old }) => !old || old.photoVersion !== PHOTO_VERSION || now - Date.parse(old.fetchedAt) > REFRESH_DAYS * 864e5 || (REFETCH[sp.key] && old.refetchedFor !== REFETCH[sp.key]))
    .sort((a, b) => (a.old ? Date.parse(a.old.fetchedAt) : 0) - (b.old ? Date.parse(b.old.fetchedAt) : 0))
    // arter der først og fremmest skal have nye billeder, kommer før almindelig opdatering
    .sort((a, b) => Number(a.old?.photoVersion === PHOTO_VERSION) - Number(b.old?.photoVersion === PHOTO_VERSION))
    .sort((a, b) => Number(!(REFETCH[a.sp.key] && a.old?.refetchedFor !== REFETCH[a.sp.key])) - Number(!(REFETCH[b.sp.key] && b.old?.refetchedFor !== REFETCH[b.sp.key])))
    .slice(0, MAX_FETCH);

  console.log(`${list.length} arter i listen. Henter ${due.length} nu (højst ${MAX_FETCH}).`);
  let ok = 0;
  for (const [i, { sp, old }] of due.entries()) {
    const data = await fetchSpecies(sp, old);
    writeJson(cachePath(sp.key), data);
    // Adressen (slug) låses første gang, så links aldrig går i stykker senere.
    if (!slugs[sp.key]) {
      const base = data.names.da ? `${slugify(data.names.da)}-${sp.key}` : sp.key;
      slugs[sp.key] = base;
    }
    const flag = data.warnings.length ? ` ⚠ ${data.warnings.length} advarsel(er)` : '';
    console.log(`[${i + 1}/${due.length}] ${sp.name} → ${data.names.da || '(intet dansk navn)'}${flag}`);
    data.warnings.forEach((w) => console.log(`    ${w}`));
    if (!data.warnings.length) ok++;
    writeJson(SLUGS_FILE, slugs); // gem løbende, hvis kørslen afbrydes
  }
  console.log(`Færdig: ${ok}/${due.length} uden advarsler.`);

  // Hent lyd til arter, der endnu ikke har været tjekket (let – kun ét kald pr. art).
  const SOUND_FETCH = Number(process.env.SOUND_FETCH || 700);
  const noSound = list.map((sp) => ({ sp, d: readCache(sp.key) })).filter(({ d }) => d && (d.soundVersion || 0) < SOUND_VERSION).slice(0, SOUND_FETCH);
  if (!XC_KEY) console.log('Ingen XC_KEY – bruger kun Wikimedia Commons til lyd.');
  let found = 0;
  for (const { sp, d } of noSound) {
    try {
      d.sound = await findSound(d.names?.accepted || sp.name, sp.region);
      d.soundVersion = SOUND_VERSION;
      if (d.sound) found++;
      writeJson(cachePath(sp.key), d);
    } catch (e) { console.log(`    lyd ${sp.name}: ${e.message}`); }
  }
  if (noSound.length) console.log(`Lyd: tjekket ${noSound.length} arter, fundet lyd til ${found}.`);

  // Taksonomi (familie og orden) fra GBIF – bruges til »Samme familie« på artssiderne. Ét kald pr. art.
  const famDa = new Map();
  const noTaxon = list.map((sp) => ({ sp, d: readCache(sp.key) })).filter(({ d }) => d && d.gbif?.key && !d.taxon);
  for (const { sp, d } of noTaxon) {
    try {
      const t = await getJson(`https://api.gbif.org/v1/species/${d.gbif.key}`, { allow404: true });
      if (!t) continue;
      let da = null;
      if (t.familyKey) {
        if (!famDa.has(t.familyKey)) {
          const v = await getJson(`https://api.gbif.org/v1/species/${t.familyKey}/vernacularNames?limit=100`, { allow404: true });
          const hit = (v?.results || []).find((x) => x.language === 'dan');
          famDa.set(t.familyKey, hit ? hit.vernacularName : null);
        }
        da = famDa.get(t.familyKey);
      }
      d.taxon = { family: t.family || null, familyKey: t.familyKey || null, familyDa: da ? da.charAt(0).toUpperCase() + da.slice(1) : null, order: t.order || null };
      writeJson(cachePath(sp.key), d);
    } catch (e) { console.log(`    taksonomi ${sp.name}: ${e.message}`); }
  }
  if (noTaxon.length) console.log(`Taksonomi: hentet for ${noTaxon.length} arter.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
