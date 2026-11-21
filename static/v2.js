// Dagens Fugl – nyt design (v2): tema, »Jeg har set den«, sektionsmenu, lydafspiller og Mine fugle.
(function () {
  var root = document.documentElement;
  var BASE = window.DF_BASE || '';

  // ---- Lyst/mørkt tema: følger systemet, indtil man selv vælger ----
  var TKEY = 'dagensfugl-tema';
  var tb = document.querySelector('.theme-btn');
  function isDark() {
    var t = root.dataset.theme;
    return t ? t === 'moerk' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  if (tb) {
    var setLabel = function () { tb.setAttribute('aria-label', isDark() ? 'Skift til lyst tema' : 'Skift til mørkt tema'); };
    setLabel();
    tb.addEventListener('click', function () {
      var next = isDark() ? 'lys' : 'moerk';
      root.dataset.theme = next;
      try { localStorage.setItem(TKEY, next); } catch (e) {}
      setLabel();
    });
  }

  // ---- Jeg har set den (gemmes kun i browseren) ----
  // Format: { art: { d: 'ÅÅÅÅ-MM-DD', p: 'sted', n: antal, c: 'note' } }
  var KEY = 'dagensfugl-set';
  function load() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
      Object.keys(o).forEach(function (k) { if (typeof o[k] === 'string') o[k] = { d: o[k], p: '' }; });
      return o;
    } catch (e) { return null; }
  }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; } }
  function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(new Date()); }
  function fmt(iso) { return new Date(iso + 'T12:00:00').toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' }); }
  var seen = load();

  var art = document.querySelector('article.species.v2[data-key]');
  if (art && seen) {
    var key = art.dataset.key;
    var cta = art.querySelector('[data-seen]');
    var bar = art.querySelector('[data-seen-bar]');
    var btns = art.querySelectorAll('.seen-btn');
    var hint = cta.querySelector('.seen-hint');
    var hint0 = hint.innerHTML;
    var render = function () {
      var e = seen[key];
      btns.forEach(function (b) {
        b.setAttribute('aria-pressed', String(!!e));
        b.querySelector('.seen-label').textContent = e ? 'Set ' + fmt(e.d) : 'Jeg har set den';
      });
      hint.innerHTML = e ? 'Gemt. <a href="' + BASE + '/preview/mine/#' + key + '">Tilføj sted og note i Mine fugle</a>' : hint0;
    };
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        if (seen[key]) {
          if ((seen[key].p || seen[key].c) && !window.confirm('Fjern ' + art.querySelector('h1').textContent + ' fra Mine fugle? Sted og note slettes også.')) return;
          delete seen[key];
        } else {
          seen[key] = { d: today(), p: '' };
        }
        save(seen); render();
      });
    });
    cta.hidden = false;
    render();
    // Fast knap nederst på mobil, når den store knap er ude af syne
    if (bar && 'IntersectionObserver' in window) {
      bar.hidden = false;
      new IntersectionObserver(function (en) { bar.classList.toggle('show', !en[0].isIntersecting); }).observe(cta);
    }
  }

  // ---- Sektionsmenu: marker den sektion, man er i ----
  var chips = document.querySelectorAll('.chips a[href^="#"]');
  if (chips.length && 'IntersectionObserver' in window) {
    var map = {};
    chips.forEach(function (a) { var t = document.getElementById(a.getAttribute('href').slice(1)); if (t) map[t.id] = a; });
    var current = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          if (current) current.classList.remove('on');
          current = map[en.target.id]; current.classList.add('on');
          var box = current.parentNode;
          var l = current.offsetLeft - box.offsetLeft;
          if (l < box.scrollLeft || l + current.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollTo({ left: l - 16, behavior: 'smooth' });
        }
      });
    }, { rootMargin: '-80px 0px -65% 0px' });
    Object.keys(map).forEach(function (id) { io.observe(document.getElementById(id)); });
  }

  // ---- Lydafspiller ----
  document.querySelectorAll('[data-player]').forEach(function (pl) {
    var audio = pl.parentNode.querySelector('audio');
    var btn = pl.querySelector('.play');
    var fill = pl.querySelector('.track span');
    var time = pl.querySelector('.time');
    var mmss = function (s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); };
    btn.addEventListener('click', function () { if (audio.paused) audio.play().catch(function () { time.textContent = 'Fejl'; }); else audio.pause(); });
    audio.addEventListener('play', function () { pl.classList.add('playing'); btn.setAttribute('aria-label', 'Stop lyden'); });
    audio.addEventListener('pause', function () { pl.classList.remove('playing'); btn.setAttribute('aria-label', 'Afspil lyden'); });
    audio.addEventListener('timeupdate', function () {
      if (audio.duration) fill.style.width = (100 * audio.currentTime / audio.duration) + '%';
      time.textContent = mmss(audio.currentTime);
    });
    audio.addEventListener('ended', function () { fill.style.width = '0'; });
    pl.querySelector('.track').addEventListener('click', function (e) {
      if (!audio.duration) return;
      var r = this.getBoundingClientRect();
      audio.currentTime = audio.duration * (e.clientX - r.left) / r.width;
    });
    var srcs = audio.querySelectorAll('source');
    if (srcs.length) srcs[srcs.length - 1].addEventListener('error', function () {
      pl.hidden = true; audio.style.display = 'block';
    });
  });

  // ---- Mine fugle ----
  var mine = document.getElementById('mine-v2');
  if (mine && seen) {
    fetch(BASE + '/arter.json').then(function (r) { return r.json(); }).then(function (list) {
      var byKey = {}; list.forEach(function (a) { byKey[a.k] = a; });
      var dk = list.filter(function (a) { return a.r === 'dk'; });
      var ul = document.getElementById('mine-items');
      var csv = document.getElementById('mine-csv');
      function stats() {
        var keys = Object.keys(seen).filter(function (k) { return byKey[k]; });
        var dkSeen = dk.filter(function (a) { return seen[a.k]; }).length;
        document.getElementById('mine-n').textContent = dkSeen;
        document.getElementById('mine-of').textContent = 'af ' + dk.length + ' danske arter set' + (keys.length > dkSeen ? ' (+' + (keys.length - dkSeen) + ' udenlandske)' : '');
        document.getElementById('mine-bar').style.width = (100 * dkSeen / dk.length).toFixed(1) + '%';
        document.getElementById('mine-empty').hidden = keys.length > 0;
        csv.disabled = !keys.length;
        return keys;
      }
      function el(tag, cls, txt) { var x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; }
      function field(label, type, name, val, full) {
        var l = el('label', full ? 'full' : ''); l.appendChild(document.createTextNode(label));
        var i = el('input'); i.type = type; i.name = name; if (val != null) i.value = val;
        if (type === 'number') { i.min = '1'; i.inputMode = 'numeric'; }
        if (type === 'text') i.maxLength = name === 'c' ? 200 : 80;
        l.appendChild(i); return l;
      }
      function sub(e) { return fmt(e.d) + (e.p ? ' · ' + e.p : ''); }
      var keys = stats().sort(function (a, b) { return seen[a].d < seen[b].d ? 1 : seen[a].d > seen[b].d ? -1 : 0; });
      keys.forEach(function (k) {
        var a = byKey[k]; var e = seen[k];
        var li = el('li'); li.id = k;
        var det = el('details');
        var sm = el('summary');
        if (a.t) { var im = el('img'); im.src = a.t; im.alt = ''; im.loading = 'lazy'; sm.appendChild(im); } else sm.appendChild(el('span', 'noimg'));
        var nm = el('span', 'm-name'); var st = el('strong', '', a.n); var sb = el('span', '', sub(e));
        nm.appendChild(st); nm.appendChild(sb); sm.appendChild(nm);
        sm.appendChild(el('span', 'm-edit', e.p ? 'Ret' : 'Tilføj sted'));
        det.appendChild(sm);
        var f = el('form', 'mine-form');
        f.appendChild(field('Hvor så du den?', 'text', 'p', e.p || '', true));
        f.appendChild(field('Dato', 'date', 'd', e.d));
        f.appendChild(field('Antal', 'number', 'n', e.n || ''));
        f.appendChild(field('Note', 'text', 'c', e.c || '', true));
        var row = el('div', 'row');
        var go = el('button', 'btn primary', 'Gem'); go.type = 'submit';
        var ok = el('span', 'ok'); ok.setAttribute('aria-live', 'polite');
        var lk = el('a', 'btn', 'Se arten'); lk.href = a.u.replace(/\/fugle\//, '/preview/fugle/');
        var rm = el('button', 'rm', 'Fjern'); rm.type = 'button';
        row.appendChild(go); row.appendChild(lk); row.appendChild(ok); row.appendChild(rm); f.appendChild(row);
        f.addEventListener('submit', function (ev) {
          ev.preventDefault();
          var n = parseInt(f.n.value, 10);
          seen[k] = { d: f.d.value || e.d, p: f.p.value.trim().slice(0, 80) };
          if (n > 0) seen[k].n = n;
          if (f.c.value.trim()) seen[k].c = f.c.value.trim().slice(0, 200);
          e = seen[k]; save(seen);
          sb.textContent = sub(e); sm.querySelector('.m-edit').textContent = e.p ? 'Ret' : 'Tilføj sted';
          ok.textContent = 'Gemt ✓'; setTimeout(function () { ok.textContent = ''; }, 2000);
        });
        rm.addEventListener('click', function () {
          if (!window.confirm('Fjern ' + a.n + ' fra Mine fugle?')) return;
          delete seen[k]; save(seen); li.remove(); stats();
        });
        det.appendChild(f); li.appendChild(det); ul.appendChild(li);
        if (location.hash === '#' + k) { det.open = true; setTimeout(function () { li.scrollIntoView({ block: 'center' }); f.p.focus(); }, 50); }
      });
      csv.addEventListener('click', function () {
        var q = function (v) { v = v == null ? '' : String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var rows = [['Art', 'Videnskabeligt navn', 'Dato', 'Sted', 'Antal', 'Note']];
        Object.keys(seen).filter(function (k) { return byKey[k]; }).sort(function (a, b) { return seen[a].d < seen[b].d ? -1 : 1; }).forEach(function (k) {
          var e = seen[k]; rows.push([byKey[k].n, byKey[k].s, e.d, e.p, e.n, e.c]);
        });
        // Semikolon og BOM, så dansk Excel åbner filen korrekt
        var blob = new Blob(['﻿' + rows.map(function (r) { return r.map(q).join(';'); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mine-fugle-' + today() + '.csv';
        document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      });
    });
  }
})();
