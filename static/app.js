(function () {
  var BASE = window.DF_BASE || '';

  // ---- Tilfældig fugl ----
  document.querySelectorAll('[data-random]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      fetch(BASE + '/fugle.json').then(function (r) { return r.json(); }).then(function (list) {
        var here = location.pathname;
        var pick = here;
        for (var i = 0; i < 5 && pick === here; i++) pick = list[Math.floor(Math.random() * list.length)];
        location.href = pick;
      }).catch(function () { location.href = a.href; });
    });
  });

  // ---- Klik på billede: vis stort ----
  var lb = document.querySelector('dialog.lightbox');
  if (lb && lb.showModal) {
    var lbImg = lb.querySelector('img');
    var lbCap = lb.querySelector('.lb-caption');
    document.addEventListener('click', function (e) {
      var img = e.target.closest && e.target.closest('.species figure img');
      if (!img) return;
      var big = img.currentSrc || img.src;
      big = big.replace(/\/(small|medium|large)\.(jpe?g|png)/i, '/original.$2');
      lbImg.src = big;
      lbImg.alt = img.alt;
      var cap = img.closest('figure').querySelector('figcaption');
      lbCap.innerHTML = cap ? cap.innerHTML : '';
      lb.showModal();
    });
    lb.addEventListener('click', function (e) { if (e.target === lb || e.target.classList.contains('lb-close') || e.target === lbImg) lb.close(); });
    lb.addEventListener('close', function () { lbImg.removeAttribute('src'); });
  }

  // ---- Jeg har set den (gemmes kun i browseren) ----
  var KEY = 'dagensfugl-set';
  function loadSeen() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return null; } }
  function saveSeen(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; } }
  var seen = loadSeen();
  if (seen) {
    var arterP = null;
    function arter() { return arterP || (arterP = fetch(BASE + '/arter.json').then(function (r) { return r.json(); })); }

    document.querySelectorAll('.card[data-key]').forEach(function (c) { if (seen[c.dataset.key]) c.classList.add('seen'); });

    document.querySelectorAll('article.species[data-key]').forEach(function (art) {
      var box = art.querySelector('.seen-box');
      if (!box) return;
      var btn = box.querySelector('.seen-btn');
      var label = box.querySelector('.seen-label');
      var count = box.querySelector('.seen-count');
      var key = art.dataset.key;
      function render() {
        var on = !!seen[key];
        btn.setAttribute('aria-pressed', String(on));
        label.textContent = on ? 'Set' : 'Jeg har set den';
        var n = Object.keys(seen).length;
        if (!n) { count.textContent = ''; return; }
        arter().then(function (list) {
          var dk = list.filter(function (a) { return a.r === 'dk'; });
          var dkSeen = dk.filter(function (a) { return seen[a.k]; }).length;
          count.textContent = 'Du har set ' + dkSeen + ' af ' + dk.length + ' danske fugle' + (n > dkSeen ? ' (+' + (n - dkSeen) + ' udenlandske)' : '') + ' →';
        }).catch(function () { count.textContent = 'Du har set ' + n + ' fugle →'; });
      }
      btn.addEventListener('click', function () {
        if (seen[key]) delete seen[key]; else seen[key] = new Date().toISOString().slice(0, 10);
        saveSeen(seen);
        render();
      });
      box.hidden = false;
      render();
    });

    var mine = document.getElementById('mine-list');
    if (mine) {
      arter().then(function (list) {
        var mineList = list.filter(function (a) { return seen[a.k]; })
          .sort(function (a, b) { return seen[b.k] < seen[a.k] ? -1 : seen[b.k] > seen[a.k] ? 1 : 0; });
        var status = document.getElementById('mine-status');
        var dk = list.filter(function (a) { return a.r === 'dk'; });
        var dkSeen = dk.filter(function (a) { return seen[a.k]; }).length;
        if (!mineList.length) {
          status.textContent = 'Du har ikke markeret nogen fugle endnu. Tryk »Jeg har set den« på en fugleside, så kommer den her. Listen gemmes kun i din egen browser.';
          return;
        }
        status.textContent = 'Du har set ' + mineList.length + (mineList.length === 1 ? ' fugl' : ' fugle') + ' – ' + dkSeen + ' af ' + dk.length + ' danske. Listen gemmes kun i din egen browser.';
        mineList.forEach(function (a) {
          var li = document.createElement('li'); li.className = 'card seen';
          var link = document.createElement('a'); link.href = a.u;
          if (a.t) { var im = document.createElement('img'); im.src = a.t; im.alt = ''; im.loading = 'lazy'; link.appendChild(im); }
          var tx = document.createElement('span'); tx.className = 'card-text';
          var lab = document.createElement('span'); lab.className = 'card-label';
          lab.textContent = new Date(seen[a.k] + 'T12:00:00').toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });
          var nm = document.createElement('span'); nm.className = 'card-name'; nm.textContent = a.n;
          var sc = document.createElement('i'); sc.textContent = a.s;
          tx.appendChild(lab); tx.appendChild(nm); tx.appendChild(sc); link.appendChild(tx); li.appendChild(link); mine.appendChild(li);
        });
      });
    }
  }

  // ---- Kort (GBIF) ----
  var GBIF_BASE = 'https://tile.gbif.org/3857/omt/{z}/{x}/{y}@1x.png?style=gbif-light';
  var GBIF_BASE_DARK = 'https://tile.gbif.org/3857/omt/{z}/{x}/{y}@1x.png?style=gbif-dark';
  var DENSITY = 'https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png?srs=EPSG:3857&bin=hex&hexPerTile=';

  function initMap(el) {
    if (el.dataset.ready || !window.L) return;
    el.dataset.ready = '1';
    var dk = el.dataset.map === 'dk';
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var map = L.map(el, { scrollWheelZoom: false, worldCopyJump: !dk, attributionControl: true, minZoom: dk ? 5 : 1 });
    if (dk) map.fitBounds([[54.5, 7.9], [57.8, 15.3]]); else map.setView([25, 10], 1);
    L.tileLayer(dark ? GBIF_BASE_DARK : GBIF_BASE, {
      maxZoom: 12,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, © OpenMapTiles',
    }).addTo(map);
    L.tileLayer(DENSITY + (dk ? 45 : 70) + '&style=classic-noborder.poly&taxonKey=' + el.dataset.taxon + (dk ? '&country=DK' : ''), {
      maxZoom: 12, opacity: 0.85,
      attribution: 'Fund: <a href="https://www.gbif.org/species/' + el.dataset.taxon + '">GBIF.org</a>',
    }).addTo(map);
  }

  function setupMaps() {
    var maps = document.querySelectorAll('.map[data-taxon]');
    if (!maps.length) return;
    if (!('IntersectionObserver' in window)) { maps.forEach(initMap); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { initMap(en.target); io.unobserve(en.target); } });
    }, { rootMargin: '300px' });
    maps.forEach(function (m) { io.observe(m); });
  }
  if (window.L) setupMaps(); else window.addEventListener('load', setupMaps);

  // ---- Søg og filter på oversigten ----
  var q = document.getElementById('q');
  var all = document.getElementById('all');
  if (q && all) {
    var cards = Array.prototype.slice.call(all.querySelectorAll('.card'));
    var buttons = document.querySelectorAll('[data-filter]');
    var count = document.getElementById('count');
    var filter = 'all';
    function norm(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
    function apply() {
      var term = norm(q.value.trim());
      var shown = 0;
      cards.forEach(function (c) {
        var ok = (filter === 'all' || c.dataset.region === filter) && (!term || norm(c.dataset.name).indexOf(term) !== -1);
        c.hidden = !ok; if (ok) shown++;
      });
      count.textContent = shown === cards.length ? '' : shown + ' af ' + cards.length + ' arter';
    }
    q.addEventListener('input', apply);
    buttons.forEach(function (b) {
      b.addEventListener('click', function () {
        filter = b.dataset.filter;
        buttons.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        apply();
      });
    });
  }
})();
