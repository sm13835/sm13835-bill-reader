// Local prototype server. Run with: node app/server.js, then open http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 3000;

function readData(name) {
  const file = path.join(ROOT, 'data', name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/brief') {
    const payload = {
      district: readData('nj05.json'),
      promises: readData('promises.json'),
      brief: readData('brief-hr1.json'),
      map: readData('nj-map.json'),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

// Bound to this computer only: the prototype has no login.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Bill Reader running at http://localhost:${PORT}`);
});
