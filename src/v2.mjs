// Nyt design (v2) af artssiderne og Mine fugle.
// Bygges indtil videre kun som preview under /preview/ (noindex), mens det gamle design kører videre.
// Alle hjælpefunktioner gives med fra build.mjs, så data og tekster er de samme.

export function makeV2(h) {
  const { esc, url, abs, nf, SITE_NAME, MONTHS, MONTHS_SHORT, regionNames, displayName, size, srcset, credit,
    relMonths, seasonText, rangeText, seasonNow, speciesJsonLd, metaDescription, mailto } = h;
  const P = (p) => url(`preview/${p.replace(/^\//, '')}`);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const dateDa = (iso) => new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

  const I = {
    eye: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    check: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    cal: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    flag: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.3 2a6 6 0 0 0 4.1-1.4.5.5 0 0 1 .6.4V14a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-7.3-2A6 6 0 0 0 4 15.5"/></svg>',
    tree: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17z"/><path d="M12 22v-3"/></svg>',
    food: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21c-4.4 0-8-3.6-8-8 0-2 2-6 8-10 6 4 8 8 8 10 0 4.4-3.6 8-8 8z"/><path d="M12 21v-9"/></svg>',
    play: '<svg class="i-play" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg><svg class="i-pause" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
    sun: '<svg class="i-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg class="i-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    down: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  };

  // ---------- Sideskabelon ----------
  function page({ title, description, canonical, body, jsonld }) {
    return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>(function(){var d=document.documentElement,t;d.classList.add('js');try{t=localStorage.getItem('dagensfugl-tema')}catch(e){}if(t==='lys'||t==='moerk')d.dataset.theme=t})()</script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="noindex">
<link rel="canonical" href="${esc(canonical)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${url('favicon.svg')}" type="image/svg+xml">
<link rel="preload" href="${url('fonts/fraunces.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${url('fonts/inter.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${url('v2.css')}">
<link rel="stylesheet" href="${url('vendor/leaflet.css')}" media="print" onload="this.media='all'">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body class="v2">
<a class="skip" href="#indhold">Spring til indhold</a>
<header class="top"><div class="wrap top-in">
  <a class="brand" href="${url('')}"><span class="brand-mark"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 38c6-1 10-6 14-12 3-5 8-9 14-9 3 0 6 2 7 5l5 2-5 2c0 9-7 17-18 18-6 1-12-1-17-6z" fill="currentColor"/></svg></span>${esc(SITE_NAME)}</a>
  <nav class="top-nav" aria-label="Hovedmenu"><a href="${url('fugle/')}">Alle fugle</a><a href="${url('maaned/')}">Måned for måned</a><a href="${url('')}">Dagens quiz</a><a href="${P('mine/')}">Mine fugle</a></nav>
  <button type="button" class="theme-btn" aria-label="Skift mellem lyst og mørkt tema" title="Lyst/mørkt tema">${I.sun}${I.moon}</button>
</div></header>
<main id="indhold">
${body}
</main>
<footer class="foot"><div class="wrap foot-in">
  <div><strong>${esc(SITE_NAME)}</strong><p>En ny fugl at gætte og lære om hver dag. Billeder, lyde og data fra åbne kilder, krediteret på hver side. Uden reklamer.</p></div>
  <div><h2>Fugle</h2><a href="${url('fugle/danske/')}">Danske fugle</a><a href="${url('fugle/udenlandske/')}">Udenlandske fugle</a><a href="${url('maaned/')}">Måned for måned</a></div>
  <div><h2>Om siden</h2><a href="${url('kilder/')}">Kilder og licenser</a><a href="${url('privatliv/')}">Privatliv</a><a href="${esc(mailto('Feedback til Dagens Fugl'))}">Giv feedback</a></div>
</div></footer>
<dialog class="lightbox" aria-label="Billede i stor størrelse"><button type="button" class="lb-close" aria-label="Luk">×</button><img alt=""><p class="lb-caption"></p></dialog>
<script>window.DF_BASE=${JSON.stringify(url('').replace(/\/$/, ''))};</script>
<script src="${url('vendor/leaflet.js')}" defer></script>
<script src="${url('app.js')}" defer></script>
<script src="${url('v2.js')}" defer></script>
</body>
</html>`;
  }

  // ---------- Afledte data ----------
  // Status i Danmark ud fra fund pr. måned (korrigeret for hvor mange der er ude at kigge).
  function statusDK(d) {
    const g = d.gbif;
    if (d.region !== 'dk') return null;
    if (!g || (g.dkTotal ?? 0) < 20 || !Array.isArray(g.dkMonths)) return 'Sjælden gæst';
    const r = relMonths(g.dkMonths);
    const avg = (ix) => ix.reduce((s, i) => s + r[i], 0) / ix.length;
    const winter = avg([11, 0, 1]); const summer = avg([5, 6]); const spring = avg([2, 3, 4]); const autumn = avg([8, 9, 10]);
    if (Math.min(...r) >= 0.3) return 'Ses hele året';
    if (winter < 0.08 && summer >= 0.25) return 'Sommergæst';
    if (summer < 0.08 && winter >= 0.25) return 'Vintergæst';
    if (summer < 0.15 && winter < 0.15 && Math.max(spring, autumn) >= 0.25) return 'Trækgæst';
    return 'Ses det meste af året';
  }
  function bestPeriod(d) {
    const g = d.gbif;
    if (!g || (g.dkTotal ?? 0) < 20 || !Array.isArray(g.dkMonths)) return null;
    const r = relMonths(g.dkMonths);
    if (Math.min(...r) >= 0.3) return 'Hele året';
    const idx = r.map((v, i) => [v, i]).filter(([v]) => v >= 0.25).map(([, i]) => i);
    return cap(rangeText(idx));
  }

  function facts(d) {
    const t = d.tekst || {};
    const out = [];
    const bp = bestPeriod(d); if (bp) out.push([I.cal, bp, 'Bedste periode']);
    const st = statusDK(d); if (st) out.push([I.flag, st, 'Status i Danmark · beregnet ud fra fund']);
    if (t.kort_levested) out.push([I.tree, t.kort_levested, 'Typisk levested']);
    if (t.kort_foede) out.push([I.food, t.kort_foede, 'Vigtigste føde']);
    if (!out.length) return '';
    return `<ul class="facts n${out.length}">${out.map(([ic, v, l]) => `<li><span class="fact-ic">${ic}</span><strong>${esc(v)}</strong><span>${esc(l)}</span></li>`).join('')}</ul>`;
  }

  function fig(photo, alt, cls, { eager = false, sizes = '(min-width: 1100px) 360px, (min-width: 700px) 33vw, 100vw' } = {}) {
    const big = cls.includes('hero');
    const set = big
      ? `src="${esc(size(photo, 'large'))}" srcset="${srcset(photo, [['medium', 500], ['large', 1024], ['original', 2048]])}" sizes="(min-width: 1180px) 1120px, 100vw"`
      : `src="${esc(photo.medium)}" srcset="${srcset(photo, [['medium', 500], ['large', 1024]])}" sizes="${sizes}"`;
    return `<figure class="${cls}"><img ${set} alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"><figcaption>${credit(photo)}</figcaption></figure>`;
  }

  // Foretræk fotos af vilde fugle: billeder fra ringmærkning (fugl i hånden) sorteres sidst, hvis iNat har markeret det.
  const wildFirst = (arr) => [...arr].sort((a, b) => (a.captive ? 1 : 0) - (b.captive ? 1 : 0));

  const GROUPS = [['male', 'Han', 'han'], ['female', 'Hun', 'hun'], ['juvenile', 'Ungfugl', 'ungfugl']];
  function plumage(d) {
    const p = d.photos || {};
    const name = displayName(d);
    let groups = GROUPS.map(([k, label, tk]) => ({ label, text: d.tekst?.[tk], photos: wildFirst(p[k] || []) })).filter((g) => g.photos.length);
    if (!groups.length) groups = [['adult', 'Voksen'], ['general', 'Flere billeder']].map(([k, label]) => ({ label, photos: p[k] || [] })).filter((g) => g.photos.length);
    if (!groups.length) return '';
    const cards = groups.map((g) => {
      const [main, ...rest] = g.photos;
      const thumbs = rest.slice(0, 3).map((ph) => `<figure class="thumb"><img src="${esc(size(ph, 'small'))}" alt="${esc(`${name}, ${g.label.toLowerCase()}`)}" loading="lazy" decoding="async" width="72" height="72"><figcaption class="sr">${credit(ph)}</figcaption></figure>`).join('');
      return `<article class="pcard">
  ${fig(main, `${name}, ${g.label.toLowerCase()}`, 'pimg')}
  <div class="pbody"><h3>${g.label}</h3>${g.text ? `<p>${esc(g.text)}</p>` : ''}${thumbs ? `<div class="thumbs" aria-label="Flere billeder">${thumbs}</div>` : ''}</div>
</article>`;
    }).join('');
    return `<section class="sec" id="fjerdragt">
  <h2>Fjerdragt</h2>
  <div class="pgrid n${groups.length}">${cards}</div>
  <p class="src">Fotos via iNaturalist. Køn og alder er angivet af iNaturalist-brugere. Klik på et billede for at se det stort.</p>
</section>`;
  }

  function sound(d) {
    const so = d.sound;
    if (!so?.src?.length) return '';
    const lic = so.licenseUrl ? `<a href="${esc(so.licenseUrl)}" rel="license noopener" target="_blank">${esc(so.license)}</a>` : esc(so.license);
    return `<section class="sec card-sec" id="lyd">
  <h2>Hør den</h2>
  <div class="player" data-player>
    <button type="button" class="play" aria-label="Afspil lyden">${I.play}</button>
    <div class="track" aria-hidden="true"><span></span></div>
    <span class="time" aria-live="off">0:00</span>
  </div>
  <audio controls preload="none">${so.src.map((x) => `<source src="${esc(x.u)}"${x.type && x.type !== 'application/ogg' ? ` type="${esc(x.type)}"` : ''}>`).join('')}</audio>
  <p class="src">${so.type ? `${esc(cap(so.type))}. ` : ''}Optaget af ${esc(so.artist || 'ukendt')}, ${lic}, via <a href="${esc(so.page)}" rel="noopener" target="_blank">${esc(so.via || 'Wikimedia Commons')}</a>.</p>
</section>`;
  }

  function about(d) {
    const name = displayName(d);
    const t = d.tekst;
    const parts = [['kendetegn', 'Kendetegn'], ['stemme', 'Stemme'], ['levested', 'Hvor lever den?'], ['foede', 'Hvad spiser den?'], ['i_danmark', 'I Danmark']];
    let inner;
    if (t) inner = parts.filter(([k]) => t[k]).map(([k, hd]) => `<h3>${hd}</h3><p>${esc(t[k])}</p>`).join('') + `<p class="src">Tekst: ${esc(SITE_NAME)}.${d.wiki ? ` Læs mere på <a href="${esc(d.wiki.url)}" rel="noopener" target="_blank">${d.wiki.lang === 'da' ? 'dansk' : 'engelsk'} Wikipedia</a>.` : ''}</p>`;
    else if (d.wiki?.extract) inner = `<div${d.wiki.lang !== 'da' ? ' lang="en"' : ''}><p>${esc(d.wiki.extract).replace(/\n+/g, '</p><p>')}</p></div><p class="src">Tekst fra <a href="${esc(d.wiki.url)}" rel="noopener" target="_blank">${d.wiki.lang === 'da' ? 'dansk' : 'engelsk'} Wikipedia</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.da" rel="license noopener" target="_blank">CC BY-SA 4.0</a>.</p>`;
    else return '';
    return `<section class="sec" id="om"><h2>Om fuglen</h2><div class="prose">${inner}</div></section>`;
  }

  function chart(rel, counts) {
    const W = 600; const H = 190; const pad = 26; const bw = (W - 8) / 12;
    const bars = rel.map((v, i) => {
      const hgt = Math.max(counts[i] > 0 ? 2 : 0, Math.round(v * (H - pad - 10)));
      return `<g><title>${cap(MONTHS[i])}: ${nf.format(counts[i])} registreringer</title><rect x="${(4 + i * bw + 4).toFixed(1)}" y="${H - pad - hgt}" width="${(bw - 8).toFixed(1)}" height="${hgt}" rx="4" class="bar"/><text x="${(4 + i * bw + bw / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle" class="axis">${MONTHS_SHORT[i]}</text></g>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hvor ofte arten ses i Danmark i hver måned"><line x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}" class="baseline"/>${bars}</svg>`;
  }

  function whenWhere(d) {
    const g = d.gbif;
    if (!g) return '';
    const upd = `Data opdateret ${dateDa(d.fetchedAt)}.`;
    const gbifA = `<a href="https://www.gbif.org/species/${g.key}" rel="noopener" target="_blank">GBIF</a>`;
    let when;
    if (g.dkTotal >= 20 && Array.isArray(g.dkMonths)) {
      when = `<div class="box" id="hvornaar"><h2>Hvornår ses den?</h2><p class="lead">${esc(seasonText(relMonths(g.dkMonths)) || '')}</p>${chart(relMonths(g.dkMonths), g.dkMonths)}<p class="src">${nf.format(g.dkTotal)} registreringer fra Danmark i ${gbifA}. Søjlerne er korrigeret for, at der generelt er flere fuglekiggere ude i nogle måneder end i andre. ${upd}</p></div>`;
    } else if (d.region === 'dk') {
      when = `<div class="box" id="hvornaar"><h2>Ses den i Danmark?</h2><p class="lead">Den er en sjælden gæst – der er kun ${nf.format(g.dkTotal || 0)} registreringer fra Danmark i GBIF.</p><p class="src">Fund af sjældne arter skal som regel godkendes af DOF's Sjældenhedsudvalg (SU). Antallet her er registreringer i GBIF, ikke antal godkendte fund. ${upd}</p></div>`;
    } else {
      when = `<div class="box" id="hvornaar"><h2>Ses den i Danmark?</h2><p class="lead">${g.dkTotal > 0 ? 'Den står ikke på Den danske liste.' : 'Nej. Den står ikke på Den danske liste og er aldrig truffet som vildtlevende fugl i Danmark.'}</p>${g.dkTotal > 0 ? `<p class="src">Der er ${nf.format(g.dkTotal)} registreringer fra Danmark i GBIF. Den slags fund er typisk fugle, der er undsluppet fra fangenskab. ${upd}</p>` : ''}</div>`;
    }
    const dkMap = g.dkTotal > 0 ? `<div class="box" id="hvor"><h2>Hvor i Danmark?</h2><p class="lead">Tæthed af fund${d.region === 'dk' ? ' og prikker for de seneste fund fra DOFbasen' : ''}.</p><div class="map" data-map="dk" data-taxon="${g.key}" aria-label="Kort over fund i Danmark"></div><p class="src">Kort: ${gbifA}${d.region === 'dk' ? ', prikker: DOFbasen via GBIF' : ''}. Baggrundskort © <a href="https://www.openstreetmap.org/copyright" rel="noopener" target="_blank">OpenStreetMap</a>, © OpenMapTiles. ${upd}</p></div>` : '';
    const countries = (g.topCountries || []).filter((c) => c.code && c.code.length === 2).slice(0, 8);
    const list = countries.length ? `<ol class="countries">${countries.map((c) => { let n; try { n = regionNames.of(c.code); } catch { n = c.code; } return `<li><span>${esc(n)}</span><span class="num">${nf.format(c.count)}</span></li>`; }).join('')}</ol>` : '';
    const world = g.worldTotal ? `<section class="sec" id="verden"><h2>Udbredelse i verden</h2><div class="world"><div class="map" data-map="world" data-taxon="${g.key}" aria-label="Verdenskort over fund"></div>${list ? `<div><h3>Lande med flest registreringer</h3>${list}</div>` : ''}</div><p class="src">${nf.format(g.worldTotal)} registreringer i alt i ${gbifA}. ${upd}</p></section>` : '';
    return `<section class="sec two${dkMap ? '' : ' one'}">${when}${dkMap}</section>${world}`;
  }

  function latest(d) {
    if (d.region !== 'dk') return '';
    const n = encodeURIComponent(d.names.accepted);
    return `<section class="sec" id="fund" data-latest="${esc(d.names.accepted)}" hidden>
  <h2>Seneste fund i Danmark <span class="via">via DOFbasen og iNaturalist</span></h2>
  <ol class="latest"></ol>
  <p class="src">Fund fra <a href="https://dofbasen.dk" rel="noopener" target="_blank">DOFbasen</a> (Dansk Ornitologisk Forening) hentes via <a href="https://www.gbif.org/dataset/95db4db8-f762-11e1-a439-00145eb45e9a" rel="noopener" target="_blank">GBIF</a> og kommer med ca. 3 ugers forsinkelse; følsomme arter er udeladt eller sløret af DOF. De nyeste fund kommer ofte fra <a href="https://www.inaturalist.org/observations?taxon_name=${n}&place_id=any&swlat=54.5&swlng=8&nelat=57.8&nelng=15.2" rel="noopener" target="_blank">iNaturalist</a>. Fundene er indtastet af brugerne og ikke nødvendigvis godkendt af DOF's Sjældenhedsudvalg.</p>
</section>`;
  }

  function faqItems(d, byKey) {
    const name = displayName(d);
    const t = d.tekst || {};
    const out = [];
    const g = d.gbif;
    if (d.region === 'dk' && g?.dkTotal >= 20 && Array.isArray(g.dkMonths)) {
      const st = statusDK(d);
      out.push([`Hvornår kan man se ${name.toLowerCase()} i Danmark?`, `${seasonText(relMonths(g.dkMonths))}${st ? ` Ud fra fundene er den ${st === 'Ses hele året' || st === 'Ses det meste af året' ? 'at finde ' + st.slice(5) : 'en ' + st.toLowerCase()}.` : ''}`]);
    }
    for (const f of t.forveksling || []) {
      const o = byKey.get(f.art);
      if (o && f.tekst) out.push([`Hvordan kender man forskel på ${name.toLowerCase()} og ${displayName(o).toLowerCase()}?`, f.tekst]);
    }
    for (const f of t.faq || []) if (f.q && f.a) out.push([f.q, f.a]);
    return out;
  }
  function faq(items) {
    if (!items.length) return '';
    return `<section class="sec" id="faq"><h2>Spørgsmål og svar</h2><div class="faq">${items.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></section>`;
  }

  function lookalikes(d, byKey, family) {
    const name = displayName(d);
    const forv = (d.tekst?.forveksling || []).map((f) => ({ o: byKey.get(f.art), t: f.kort || f.tekst })).filter((x) => x.o);
    const fam = family(d).filter((x) => x.key !== d.key && !forv.some((f) => f.o.key === x.key)).slice(0, 10);
    if (!forv.length && !fam.length) return '';
    const famName = d.taxon?.familyDa || d.taxon?.family;
    return `<section class="sec" id="lignende">
  ${forv.length ? `<h2>Kan forveksles med</h2><ul class="rel">${forv.map(({ o, t }) => `<li><a href="${P(`fugle/${o.slug}/`)}">${o.photos?.hero ? `<img src="${esc(size(o.photos.hero, 'small'))}" alt="" loading="lazy" width="96" height="96">` : ''}<span><strong>${esc(displayName(o))}</strong><i>${esc(o.names.accepted)}</i>${t ? `<span>${esc(t)}</span>` : ''}</span></a></li>`).join('')}</ul>` : ''}
  ${fam.length ? `<${forv.length ? 'h3' : 'h2'}>${forv.length ? '' : 'Lignende arter: '}${famName ? `${forv.length ? 'Samme familie' : 'samme familie'}: ${esc(famName)}` : `samme slægt som ${esc(name.toLowerCase())}`}</${forv.length ? 'h3' : 'h2'}><ul class="chips-list">${fam.map((o) => `<li><a href="${P(`fugle/${o.slug}/`)}">${esc(displayName(o))}</a></li>`).join('')}</ul>` : ''}
</section>`;
  }

  function sources(d) {
    const links = [];
    if (d.wiki) links.push(`<a href="${esc(d.wiki.url)}" rel="noopener" target="_blank">Wikipedia</a>`);
    if (d.inat?.id) links.push(`<a href="https://www.inaturalist.org/taxa/${d.inat.id}" rel="noopener" target="_blank">iNaturalist</a>`);
    if (d.gbif?.key) links.push(`<a href="https://www.gbif.org/species/${d.gbif.key}" rel="noopener" target="_blank">GBIF</a>`);
    if (d.wikidata?.id) links.push(`<a href="https://www.wikidata.org/wiki/${d.wikidata.id}" rel="noopener" target="_blank">Wikidata</a>`);
    return `<section class="sec small" id="kilder"><h2>Kilder</h2><p>${links.join(' · ')}. Data hentet ${dateDa(d.fetchedAt)}. Se også <a href="${url('kilder/')}">kilder og licenser</a>. Ser du en fejl? <a href="${esc(mailto(`Dagens Fugl: ${displayName(d)}`, `Side: ${abs(`fugle/${d.slug}/`)}\n\n`))}">Skriv til os</a>.</p></section>`;
  }

  function speciesPage(d, { byKey, family }) {
    const name = displayName(d);
    const rare = d.region === 'dk' && (d.gbif?.dkTotal ?? 0) < 20;
    const tag = rare ? '<span class="tag rare">Sjælden gæst i Danmark</span>' : d.region === 'dk' ? '<span class="tag">Dansk fugl</span>' : '<span class="tag">Udenlandsk fugl</span>';
    const now = seasonNow(d);
    const sec = d.region === 'dk' ? ['fugle/danske/', 'Danske fugle'] : ['fugle/udenlandske/', 'Udenlandske fugle'];
    const faqs = faqItems(d, byKey);
    const chips = [
      (d.tekst || d.wiki?.extract) && ['om', 'Om fuglen'],
      d.sound?.src?.length && ['lyd', 'Lyd'],
      d.photos && ['fjerdragt', 'Fjerdragt'],
      d.gbif && ['hvornaar', 'Hvornår'],
      d.gbif?.dkTotal > 0 && ['hvor', 'Hvor'],
      d.region === 'dk' && ['fund', 'Seneste fund'],
      faqs.length && ['faq', 'Spørgsmål'],
      ['lignende', 'Lignende arter'],
    ].filter(Boolean);
    const body = `<article class="species v2" data-key="${esc(d.key)}" data-region="${d.region}">
<div class="wrap">
  <nav class="crumbs" aria-label="Brødkrumme"><a href="${url('')}">Forside</a> › <a href="${url(sec[0])}">${sec[1]}</a> › ${esc(name)}</nav>
  <header class="head">
    <div class="head-name">
      <h1>${esc(name)}</h1>
      <p class="names"><i>${esc(d.names.accepted)}</i>${d.names.da && d.names.en ? `<span>${esc(d.names.en)}</span>` : ''}${tag}</p>
      ${now ? `<p class="now now-${now.level}"><span class="dot" aria-hidden="true"></span><strong>${esc(now.text)}</strong>${now.more ? ` <span>${esc(now.more)}</span>` : ''}</p>` : ''}
    </div>
    <div class="cta" data-seen hidden>
      <button type="button" class="seen-btn" aria-pressed="false"><span class="ic-off">${I.eye}</span><span class="ic-on">${I.check}</span><span class="seen-label">Jeg har set den</span></button>
      <p class="seen-hint">Ét klik gemmer den i <a href="${P('mine/')}">Mine fugle</a></p>
    </div>
  </header>
  ${d.photos?.hero ? fig(d.photos.hero, `${name}`, 'hero', { eager: true }) : ''}
  ${facts(d)}
</div>
<nav class="chips" aria-label="Indhold på siden"><div class="wrap chips-in">${chips.map(([id, l]) => `<a href="#${id}">${l}</a>`).join('')}</div></nav>
<div class="wrap secs">
  ${about(d)}
  ${sound(d)}
  ${plumage(d)}
  ${whenWhere(d)}
  ${latest(d)}
  ${faq(faqs)}
  ${lookalikes(d, byKey, family) || '<span id="lignende"></span>'}
  ${sources(d)}
</div>
<div class="cta-bar" data-seen-bar hidden><button type="button" class="seen-btn" aria-pressed="false"><span class="ic-off">${I.eye}</span><span class="ic-on">${I.check}</span><span class="seen-label">Jeg har set den</span></button></div>
</article>`;
    const ld = speciesJsonLd(d, abs(`fugle/${d.slug}/`));
    if (faqs.length) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
    return page({
      title: `${name} (${d.names.accepted}) – fjerdragt, hvor og hvornår | ${SITE_NAME}`,
      description: metaDescription(d),
      canonical: abs(`fugle/${d.slug}/`),
      jsonld: ld,
      body,
    });
  }

  function minePage() {
    return page({
      title: `Mine fugle | ${SITE_NAME}`,
      description: 'De fugle du har markeret som set på Dagens Fugl.',
      canonical: abs('mine/'),
      body: `<div class="wrap mine" id="mine-v2">
  <h1>Mine fugle</h1>
  <div class="mine-top">
    <div class="mine-stat"><strong id="mine-n">0</strong><span id="mine-of">danske arter set</span><div class="bar"><span id="mine-bar"></span></div></div>
    <button type="button" class="btn ghost" id="mine-csv" disabled>${I.down}Hent som CSV</button>
  </div>
  <p class="src" id="mine-empty" hidden>Du har ikke markeret nogen fugle endnu. Tryk »Jeg har set den« på en fugleside, så kommer den her.</p>
  <ul class="mine-list" id="mine-items"></ul>
  <p class="src">Listen gemmes kun i din egen browser og sendes ingen steder hen. Skifter du browser eller telefon, eller rydder du browserdata, starter listen forfra. Hent den som CSV, hvis du vil gemme den.</p>
</div>`,
    });
  }

  return { speciesPage, minePage, statusDK, P };
}
