// Lille lokal server til at se siden: node src/preview-server.mjs → http://localhost:8080
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DIST_DIR } from './common.mjs';
import { BASE_PATH } from './config.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.xml': 'application/xml', '.txt': 'text/plain' };
const PORT = Number(process.env.PORT || 8080);

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (BASE_PATH && p.startsWith(BASE_PATH)) p = p.slice(BASE_PATH.length) || '/';
  let file = path.join(DIST_DIR, p);
  if (!file.startsWith(DIST_DIR)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': TYPES['.html'] }); fs.createReadStream(path.join(DIST_DIR, '404.html')).pipe(res); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Se siden på http://localhost:${PORT}${BASE_PATH}/`));
