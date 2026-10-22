'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const indexPath = path.join(ROOT, 'index.html');
if (!fs.existsSync(indexPath)) throw new Error('index.html is missing');

const rooms = new Map();
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
const allowedTypes = new Set([
  'hello','sig','chat','state','hand','share','file','bye','react',
  'knock','admit','rec','kick','board','poll'
]);

function baseUrl(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  const protocol = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return (protocol === 'http' ? 'http://' : 'https://') + host;
}
function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self)',
    'Cache-Control': type.includes('text/html') ? 'no-cache' : 'public, max-age=300'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
  if (u.pathname === '/googlecb5be73c533d6839.html') return send(res, 200, 'text/html; charset=utf-8', 'google-site-verification: googlecb5be73c533d6839.html');
  if (u.pathname === '/healthz') return send(res, 200, 'application/json; charset=utf-8', '{"ok":true,"service":"gaprou"}');
  if (u.pathname === '/robots.txt') {
    const body = 'User-agent: *\nAllow: /\nSitemap: ' + baseUrl(req) + '/sitemap.xml\n';
    return send(res, 200, 'text/plain; charset=utf-8', body);
  }
  if (u.pathname === '/sitemap.xml') {
    const body = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' +
      xmlEscape(baseUrl(req) + '/') + '</loc><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>';
    return send(res, 200, 'application/xml; charset=utf-8', body);
  }
  if (u.pathname === '/manifest.webmanifest') {
    return send(res, 200, 'application/manifest+json; charset=utf-8', fs.readFileSync(path.join(ROOT, 'manifest.webmanifest')));
  }
  if (u.pathname === '/sw.js') {
    return send(res, 200, 'application/javascript; charset=utf-8', fs.readFileSync(path.join(ROOT, 'sw.js')));
  }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    const base = baseUrl(req);
    let html = fs.readFileSync(indexPath, 'utf8');
    const seo = '<link rel="canonical" href="' + xmlEscape(base + '/') + '">' +
      '<meta name="robots" content="index,follow,max-image-preview:large">' +
      '<meta property="og:title" content="گپ‌رو | جلسه آنلاین">' +
      '<meta property="og:description" content="جلسه آنلاین فارسی با ویدیو، صدا، چت و اشتراک صفحه.">' +
      '<meta property="og:type" content="website">' +
      '<meta property="og:url" content="' + xmlEscape(base + '/') + '">' +
      '<meta name="twitter:card" content="summary">';
    html = html.replace('</head>', seo + '\n</head>');
    return send(res, 200, 'text/html; charset=utf-8', req.method === 'HEAD' ? '' : html);
  }
  return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
});

server.on('upgrade', (req, socket, head) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
  if (u.pathname !== '/ws') { socket.destroy(); return; }
  const room = u.searchParams.get('room') || '';
  if (!/^[\w-]{1,64}$/.test(room)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    ws.roomCode = room;
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(ws);
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', ws => {
  ws.on('message', raw => {
    if (ws.readyState !== WebSocket.OPEN || !ws.roomCode) return;
    let packet;
    try { packet = JSON.parse(raw.toString()); } catch { return; }
    if (!packet || typeof packet.t !== 'string' || !allowedTypes.has(packet.t) ||
        !packet.d || typeof packet.d !== 'object' || Array.isArray(packet.d)) return;
    const payload = JSON.stringify({ t: packet.t, d: packet.d });
    const peers = rooms.get(ws.roomCode);
    if (!peers) return;
    for (const peer of peers) {
      if (peer !== ws && peer.readyState === WebSocket.OPEN) {
        try { peer.send(payload); } catch {}
      }
    }
  });
  ws.on('close', () => {
    const peers = rooms.get(ws.roomCode);
    if (!peers) return;
    peers.delete(ws);
    if (!peers.size) rooms.delete(ws.roomCode);
  });
  ws.on('error', () => {});
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Gaprou listening on port ' + PORT);
});
