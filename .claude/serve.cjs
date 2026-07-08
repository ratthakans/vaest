const http = require('http'), fs = require('fs');
http.createServer((q, s) => {
  let f = q.url === '/' ? '/index.html' : q.url;
  f = f.split('?')[0];
  const ct = f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/plain; charset=utf-8';
  try { const d = fs.readFileSync(__dirname + '/..' + f); s.writeHead(200, { 'Content-Type': ct }); s.end(d); }
  catch (e) { s.writeHead(404); s.end('nf'); }
}).listen(4599, () => console.log('up on 4599'));
