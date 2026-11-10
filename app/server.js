// Local prototype server. Run with: node app/server.js, then open http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const { getBill, listBills, saveUpload, MAX_FILE_BYTES } = require('./bills.js');
const { estimateFor, runAnalysis, loadKey, checkAvailableCredits } = require('./analyze.js');

const hasKey = loadKey(); // Reads OPENROUTER_API_KEY from the Git-ignored .env file.

// One paid run at a time, kept in memory. Restarting the server forgets it.
let job = null;

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const PORT = 3000;
const MAX_BODY_BYTES = Math.ceil(MAX_FILE_BYTES * 1.4) + 5 * 1024 * 1024; // base64 file + extracted text
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const listJson = (dir) => fs.readdirSync(path.join(DATA, dir)).filter((f) => f.endsWith('.json'));

// Ids come from the browser, so they are only ever matched against the files that exist,
// never used to build a path directly.
const members = () => listJson('members').map((f) => readJson(path.join(DATA, 'members', f)));
const districts = () => listJson('districts').map((f) => readJson(path.join(DATA, 'districts', f)));

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Upload too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function billSummary(bill, memberId) {
  return {
    id: bill.id,
    title: bill.title,
    kind: bill.kind,
    status: bill.status,
    file_type: bill.file_type,
    created_at: bill.created_at,
    section_count: bill.section_count,
    has_brief: memberId ? fs.existsSync(bill.briefFile(memberId)) : undefined,
  };
}

const PUBLIC_FILES = { '/': 'index.html', '/bill-text.js': 'bill-text.js' };

async function handle(req, res) {
  // Only pages served from this computer may talk to this server. This blocks other
  // websites from reading drafts or uploading through your browser.
  if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 403, { error: 'Forbidden host' });
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && PUBLIC_FILES[url.pathname]) {
    const file = PUBLIC_FILES[url.pathname];
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'public', file)));
    return;
  }

  // The setup screen: every member and the district each one represents.
  if (req.method === 'GET' && url.pathname === '/api/members') {
    const list = members()
      .map((m) => ({ id: m.id, name: m.name, title: m.title, party: m.party, district: m.district, note: m.note }))
      .sort((a, b) => Number(a.district.split('-')[1]) - Number(b.district.split('-')[1]));
    return send(res, 200, { members: list });
  }

  // The bill picker: H.R. 1 and every uploaded bill, with whether this member has a brief.
  if (req.method === 'GET' && url.pathname === '/api/bills') {
    const member = members().find((m) => m.id === url.searchParams.get('member'));
    return send(res, 200, { bills: listBills().map((b) => billSummary(b, member && member.id)) });
  }

  // Changes (uploads, paid runs) must come from this app's own page, as JSON. A JSON request
  // from another site needs the browser's permission first, which this server never gives.
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, 403, { error: 'Forbidden origin' });
    if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'Expected JSON' });
  }

  // What a run would cost, and whether the account can cover its cap. Nothing is spent.
  if (req.method === 'GET' && url.pathname === '/api/estimate') {
    const member = members().find((m) => m.id === url.searchParams.get('member'));
    const bill = getBill(url.searchParams.get('bill'));
    if (!member || !bill) return send(res, 404, { error: 'Unknown member or bill' });
    const { estimate, cap } = estimateFor(member.id, bill.id);
    let available = null;
    if (hasKey) {
      try {
        available = await checkAvailableCredits();
      } catch {
        available = null;
      }
    }
    return send(res, 200, { estimate, cap, has_key: hasKey, available, busy: Boolean(job && job.status === 'running') });
  }

  // Starts a paid run. The page must send back the cap it showed, so a person agreed to it.
  if (req.method === 'POST' && url.pathname === '/api/analyze') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: 'Bad request' });
    }
    const member = members().find((m) => m.id === body.member);
    const bill = getBill(body.bill);
    if (!member || !bill || member.district !== body.district) return send(res, 400, { error: 'Unknown member, district or bill' });
    if (!hasKey) return send(res, 400, { error: 'No OpenRouter key in .env' });
    if (job && job.status === 'running') return send(res, 409, { error: 'Another analysis is already running. Try again when it finishes.' });
    const { estimate, cap } = estimateFor(member.id, bill.id);
    if (Number(body.accepted_cap) !== cap) return send(res, 409, { error: 'The cost estimate changed. Review it and confirm again.' });

    job = { member: member.id, bill: bill.id, status: 'running', progress: [], started_at: new Date().toISOString(), estimate, cap };
    const current = job;
    runAnalysis({ memberId: member.id, billId: bill.id, onProgress: (message) => current.progress.push(message) })
      .then((brief) => Object.assign(current, { status: 'done', cost: brief.cost_usd }))
      .catch((error) => Object.assign(current, { status: 'error', error: error.message }));
    return send(res, 202, { job });
  }

  if (req.method === 'GET' && url.pathname === '/api/analyze/status') {
    const matches = job && job.member === url.searchParams.get('member') && job.bill === url.searchParams.get('bill');
    return send(res, 200, { job: matches ? job : null, busy: Boolean(job && job.status === 'running') });
  }

  if (req.method === 'POST' && url.pathname === '/api/bills') {
    try {
      const meta = saveUpload(JSON.parse(await readBody(req)));
      return send(res, 201, { bill: meta });
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
  }

  // The original PDF of an uploaded bill, so section links can open it at the right page.
  const fileMatch = /^\/api\/bills\/([a-z0-9]+)\/file$/.exec(url.pathname);
  if (req.method === 'GET' && fileMatch) {
    const bill = getBill(fileMatch[1]);
    if (!bill || bill.kind !== 'upload' || bill.file_type !== 'pdf') return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline' });
    fs.createReadStream(bill.filePath).pipe(res);
    return;
  }

  // One member's brief on one bill. Member and district data are loaded separately and must match.
  if (req.method === 'GET' && url.pathname === '/api/brief') {
    const member = members().find((m) => m.id === url.searchParams.get('member'));
    if (!member) return send(res, 404, { error: 'Unknown member' });
    const district = districts().find((d) => d.id === url.searchParams.get('district'));
    if (!district) return send(res, 404, { error: 'Unknown district' });
    if (member.district !== district.id) {
      return send(res, 400, { error: `${member.name} represents ${member.district}, not ${district.id}` });
    }
    const bill = getBill(url.searchParams.get('bill') || 'hr1');
    if (!bill) return send(res, 404, { error: 'Unknown bill' });
    return send(res, 200, {
      member,
      district,
      bill: {
        ...billSummary(bill),
        pdf_url: bill.pdf_url,
        // Uploaded bills ship their text so the page can show it; H.R. 1 links to GovInfo.
        sections: bill.kind === 'upload' ? bill.loadSections() : undefined,
      },
      brief: readJson(bill.briefFile(member.id)),
      map: readJson(path.join(DATA, 'nj-map.json')),
    });
  }

  send(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) send(res, 500, { error: 'Server error' });
  });
});

// Bound to this computer only: the prototype has no real login.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Bill Reader running at http://localhost:${PORT}`);
});
