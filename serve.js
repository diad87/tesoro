// Servidor estático mínimo para probar en el ordenador:  node serve.js  →  http://localhost:5173
const http = require('http'), fs = require('fs'), path = require('path');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const port = process.env.PORT || 5173;
http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(__dirname, path.normalize(rel === '/' ? '/index.html' : rel));
  if (!file.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => console.log(`Búsqueda del tesoro en http://localhost:${port}`));
