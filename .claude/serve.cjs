const http = require('http'), https = require('https'), fs = require('fs');
const API_ORIGIN = 'vaest-orions.vercel.app'; // dev proxy — /api/* runs against production
http.createServer((q, s) => {
  if (q.url.startsWith('/api/')) {
    const body = [];
    q.on('data', c => body.push(c));
    q.on('end', () => {
      const p = https.request({ hostname: API_ORIGIN, path: q.url, method: q.method,
        headers: { 'Content-Type': q.headers['content-type'] || 'application/json', Authorization: q.headers.authorization || '' } },
        r => { s.writeHead(r.statusCode, { 'Content-Type': r.headers['content-type'] || 'text/plain' }); r.pipe(s); });
      p.on('error', () => { s.writeHead(502); s.end('proxy error'); });
      p.end(Buffer.concat(body));
    });
    return;
  }
  let f = q.url === '/' ? '/index.html' : q.url;
  f = f.split('?')[0];
  const ct = f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript; charset=utf-8' : f.endsWith('.css') ? 'text/css; charset=utf-8' : f.endsWith('.svg') ? 'image/svg+xml' : 'text/plain; charset=utf-8';
  try { const d = fs.readFileSync(__dirname + '/..' + f); s.writeHead(200, { 'Content-Type': ct }); s.end(d); }
  catch (e) { s.writeHead(404); s.end('nf'); }
}).listen(4599, () => console.log('up on 4599'));
