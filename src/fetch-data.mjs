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
import {
  loadSpeciesList, readCache, writeJson, cachePath, readJson, sleep,
  CACHE_DIR, SLUGS_FILE, slugify,
} from './common.mjs';
import { USER_AGENT, MAX_FETCH, REFRESH_DAYS, PHOTO_LICENSES } from './config.mjs';

const HEADERS = { 'User-Agent': USER_AGENT, 'Accept': 'application/json', 'Api-User-Agent': USER_AGENT };

// Minimum pause mellem kald pr. vært (ms). iNaturalist beder om højst ca. 1 kald i sekundet.
const HOST_DELAY = { 'api.inaturalist.org': 1100, default: 250 };
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
  if (inatId) {
    const d = await getJson(`https://api.inaturalist.org/v1/taxa/${inatId}?locale=da`, { allow404: true });
    if (d?.results?.[0]) return d.results[0];
  }
  const d = await getJson(`https://api.inaturalist.org/v1/taxa?q=${q(sciName)}&rank=species&is_active=true&locale=da&per_page=10`);
  const res = d?.results || [];
  return res.find((t) => t.name === sciName)
    || res.find((t) => (t.matched_term || '').toLowerCase() === sciName.toLowerCase())
    || null;
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

// ---------- GBIF ----------
async function gbifKey(sciName, fromWikidata) {
  if (fromWikidata) {
    const sp = await getJson(`https://api.gbif.org/v1/species/${fromWikidata}`, { allow404: true });
    if (sp?.key) return sp.acceptedKey || sp.key;
  }
  const m = await getJson(`https://api.gbif.org/v1/species/match?name=${q(sciName)}&kingdom=Animalia&class=Aves`);
  if (!m || m.matchType === 'NONE' || !m.usageKey) return null;
  return m.acceptedUsageKey || m.usageKey;
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
  const gKey = await step('gbif match', () => gbifKey(sp.name, wd?.gbif));

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
    const hero = cleanPhoto(taxon.default_photo, null);
    if (photos) photos.hero = hero || photos.male?.[0] || photos.adult?.[0] || photos.general?.[0] || photos.female?.[0] || null;
  }

  const gbif = gKey ? await step('gbif statistik', () => gbifStats(gKey)) : undefined;

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
    warnings: warn,
  };
}

// ---------- Hovedløkke ----------
async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const list = loadSpeciesList();
  const slugs = readJson(SLUGS_FILE, {});
  const now = Date.now();
  const due = list
    .map((sp) => ({ sp, old: readCache(sp.key) }))
    .filter(({ old }) => !old || now - Date.parse(old.fetchedAt) > REFRESH_DAYS * 864e5)
    .sort((a, b) => (a.old ? Date.parse(a.old.fetchedAt) : 0) - (b.old ? Date.parse(b.old.fetchedAt) : 0))
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
}

main().catch((e) => { console.error(e); process.exit(1); });
