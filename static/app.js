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
