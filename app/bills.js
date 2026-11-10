// The bills the app knows about: H.R. 1 (built in) and bills a user uploads.
// Uploads live in data/uploads/<id>/, which Git ignores so draft bills never reach GitHub.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BillText = require('./public/bill-text.js');

const DATA = path.join(__dirname, '..', 'data');
const UPLOADS = path.join(DATA, 'uploads');
const UPLOAD_ID = /^u[0-9a-f]{12}$/;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const TYPES = {
  pdf: { magic: '%PDF-', label: 'PDF' },
  docx: { magic: 'PK\u0003\u0004', label: 'Word document' },
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const HR1 = {
  id: 'hr1',
  title: 'H.R. 1: One Big Beautiful Bill Act',
  kind: 'official',
  status: 'Enacted July 4, 2025',
  file_type: 'pdf',
};

function hr1() {
  const pageMap = readJson(path.join(DATA, 'hr1-pages.json'));
  return {
    ...HR1,
    pdf_url: pageMap.pdf_url,
    loadSections: () => readJson(path.join(DATA, 'hr1-sections.json')),
    pages: pageMap.pages,
    issuesFile: path.join(DATA, 'hr1-issues.json'),
    briefFile: (memberId) => path.join(DATA, 'briefs', `hr1-${memberId}.json`),
  };
}

function upload(id) {
  if (!UPLOAD_ID.test(id || '')) return null;
  const dir = path.join(UPLOADS, id);
  if (!fs.existsSync(path.join(dir, 'bill.json'))) return null;
  const meta = readJson(path.join(dir, 'bill.json'));
  const sections = () => readJson(path.join(dir, 'sections.json'));
  return {
    ...meta,
    kind: 'upload',
    pdf_url: meta.file_type === 'pdf' ? `/api/bills/${id}/file` : null,
    loadSections: sections,
    get pages() {
      return Object.fromEntries(sections().filter((s) => s.page).map((s) => [s.id, s.page]));
    },
    filePath: path.join(dir, `original.${meta.file_type}`),
    issuesFile: path.join(dir, 'issues.json'),
    briefFile: (memberId) => path.join(dir, 'briefs', `${memberId}.json`),
  };
}

// Ids come from the browser, so they only ever select a bill that exists.
function getBill(id) {
  if (!id || id === 'hr1') return hr1();
  return upload(id);
}

function listBills() {
  const uploads = fs.existsSync(UPLOADS)
    ? fs.readdirSync(UPLOADS).map(upload).filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at))
    : [];
  return [hr1(), ...uploads];
}

// Checks an upload and saves it. The browser extracted the text (the server has no PDF or
// Word reader); the server re-splits that text itself and keeps the original file.
function saveUpload({ title, file_type, file_name, file_base64, pages }) {
  const name = String(title || '').replace(/[\u0000-\u001f]/g, '').trim();
  if (!name) throw new Error('Give the bill a name.');
  if (name.length > 120) throw new Error('Keep the name under 120 characters.');
  const type = TYPES[file_type];
  if (!type) throw new Error('Only PDF and Word (.docx) files are supported.');
  const bytes = Buffer.from(String(file_base64 || ''), 'base64');
  if (!bytes.length) throw new Error('The file is empty.');
  if (bytes.length > MAX_FILE_BYTES) throw new Error('The file is larger than 15 MB.');
  if (bytes.subarray(0, type.magic.length).toString('latin1') !== type.magic) {
    throw new Error(`This file is not a valid ${type.label}.`);
  }
  if (!Array.isArray(pages) || !pages.every((p) => Array.isArray(p) && p.every((l) => typeof l === 'string'))) {
    throw new Error('The extracted text was not in the expected format.');
  }

  const result = BillText.fromPages(pages);
  // A Word file has no fixed pages, so its sections have none.
  const sections = result.sections.map((s) => ({ ...s, page: file_type === 'pdf' ? s.page : null }));

  const id = `u${crypto.randomBytes(6).toString('hex')}`;
  const dir = path.join(UPLOADS, id);
  fs.mkdirSync(path.join(dir, 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(dir, `original.${file_type}`), bytes);
  fs.writeFileSync(path.join(dir, 'sections.json'), JSON.stringify(sections, null, 1));
  const meta = {
    id,
    title: name,
    status: 'Uploaded; not yet voted on',
    file_type,
    file_name: path.basename(String(file_name || `bill.${file_type}`)).slice(0, 200),
    created_at: new Date().toISOString(),
    section_count: sections.length,
    split_method: result.method,
    skipped_chars: result.skipped_chars,
    chars: result.chars,
  };
  fs.writeFileSync(path.join(dir, 'bill.json'), JSON.stringify(meta, null, 2));
  return meta;
}

module.exports = { getBill, listBills, saveUpload, UPLOADS, MAX_FILE_BYTES };
