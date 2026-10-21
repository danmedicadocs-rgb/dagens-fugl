import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const CACHE_DIR = process.env.CACHE_DIR || path.join(DATA_DIR, 'cache');
export const SLUGS_FILE = process.env.SLUGS_FILE || path.join(DATA_DIR, 'slugs.json');
export const DIST_DIR = process.env.DIST_DIR || path.join(ROOT, 'dist');

export function loadSpeciesList() {
  const txt = fs.readFileSync(path.join(DATA_DIR, 'species.txt'), 'utf8');
  const seen = new Set();
  const list = [];
  for (const raw of txt.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(dk|verden)\s+(.+)$/);
    if (!m) { console.warn(`Ukendt linje i species.txt: ${line}`); continue; }
    const name = m[2].trim().replace(/\s+/g, ' ');
    const key = sciKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ region: m[1], name, key });
  }
  return list;
}

export function sciKey(name) {
  return name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
}

export function slugify(s) {
  return s.toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function cachePath(key) {
  return path.join(CACHE_DIR, `${key}.json`);
}

export function readCache(key) {
  try { return JSON.parse(fs.readFileSync(cachePath(key), 'utf8')); } catch { return null; }
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 1) + '\n');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
