// Fælles indstillinger. De fleste kan overskrives med miljøvariabler i GitHub Actions.

export const SITE_NAME = process.env.SITE_NAME || 'Dagens Fugl';

// Fuld adresse til siden, fx https://hassesimonsen.github.io/dagens-fugl
// eller https://dagensfugl.dk. Bruges til sitemap, canonical-links og delingsbilleder.
export const SITE_URL = (process.env.SITE_URL || 'https://example.github.io/dagens-fugl').replace(/\/$/, '');
export const BASE_PATH = new URL(SITE_URL + '/').pathname.replace(/\/$/, ''); // '' eller '/dagens-fugl'

export const TIMEZONE = 'Europe/Copenhagen';

// Billedlicenser der må bruges. Standard er licenser der også tillader kommerciel brug,
// så der aldrig er tvivl. Sæt ALLOW_NONCOMMERCIAL=true hvis siden er helt ikke-kommerciel
// (ingen reklamer, intet salg) – så kommer der markant flere billeder med.
export const ALLOW_NONCOMMERCIAL = process.env.ALLOW_NONCOMMERCIAL === 'true';
export const PHOTO_LICENSES = ALLOW_NONCOMMERCIAL
  ? ['cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa']
  : ['cc0', 'cc-by', 'cc-by-sa'];

// Hvor mange arter der højst hentes data for pr. kørsel, og hvor gamle data må være.
export const MAX_FETCH = Number(process.env.MAX_FETCH || 60);
export const REFRESH_DAYS = Number(process.env.REFRESH_DAYS || 90);

// Kontakt i User-Agent – Wikipedia og iNaturalist beder om det.
export const CONTACT = process.env.CONTACT || SITE_URL;
export const USER_AGENT = `DagensFugl/1.0 (${CONTACT})`;

// Hvornår begynder rækkefølgen. Ændr ikke efter lancering, ellers skifter dagens fugl.
export const SCHEDULE_START = '2026-01-01';
export const SCHEDULE_SEED = 'dagens-fugl';
