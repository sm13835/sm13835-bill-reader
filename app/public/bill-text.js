// Turns the text of an uploaded bill into sections. Shared by the browser (to preview an
// upload before saving), the server (which re-splits on save, so the browser is not trusted)
// and the tests. Pure functions only: no file, network or page access.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BillText = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_SECTIONS = 2000;
  const MAX_CHARS = 3000000;
  const CHUNK_CHARS = 6000;

  const isNumber = (s) => /^\d{1,3}$/.test(s.trim());

  // PDF text pieces ({str, x, y, w}) for one page → lines of text, top to bottom.
  // GPO bills print line numbers in a column left of the text; those are removed.
  function pageLines(items) {
    // Sideways printer's marks in the margin are not bill text.
    const real = items.filter((i) => i.str.trim() !== '' && !i.rotated);
    const text = real.filter((i) => !isNumber(i.str));
    const columns = {};
    for (const i of real.filter((i) => isNumber(i.str))) {
      const x = Math.round(i.x);
      columns[x] = (columns[x] || 0) + 1;
    }
    // A margin column holds only numbers, and every one of them starts its line.
    const margins = Object.keys(columns).map(Number).filter((x) =>
      columns[x] >= 3 &&
      !text.some((t) => Math.abs(t.x - x) <= 2) &&
      real.filter((i) => isNumber(i.str) && Math.abs(i.x - x) <= 2)
        .every((n) => !real.some((o) => o !== n && Math.abs(o.y - n.y) <= 2 && o.x < n.x)));
    const kept = real.filter((i) => !(isNumber(i.str) && margins.some((m) => Math.abs(m - i.x) <= 2)));

    const rows = [];
    for (const item of [...kept].sort((a, b) => b.y - a.y)) {
      const row = rows.find((r) => Math.abs(r.y - item.y) <= 2);
      if (row) row.items.push(item);
      else rows.push({ y: item.y, items: [item] });
    }
    return rows.map((row) => {
      let line = '';
      let end = null;
      for (const item of row.items.sort((a, b) => a.x - b.x)) {
        if (end !== null && item.x - end > 1.5 && !line.endsWith(' ') && !item.str.startsWith(' ')) line += ' ';
        line += item.str;
        end = item.x + item.w;
      }
      return line.replace(/\s+/g, ' ').trim();
    });
  }

  // Removes printing marks: running headers like "H. R. 1—98", page numbers,
  // GPO footers ("VerDate…", "•HR 9626 IH") and the end mark "Æ".
  function cleanPage(lines) {
    const pageMark = /^([HS]\.\s?(R\.|Res\.|J\.\s?Res\.)?\s?\d+\s*[—-]\s*)?\d{1,4}$/;
    const out = lines.filter((l) => l && !/VerDate \w+ \d+ \d{4}\b/.test(l) && !/^•/.test(l) && l !== 'Æ');
    if (out.length && pageMark.test(out[0])) out.shift();
    if (out.length && pageMark.test(out[out.length - 1])) out.pop();
    return out;
  }

  // Joins pages into one text, rejoining words split across lines ("re-" + "turn").
  // Returns the start offset of each page so a section can be traced to its page.
  function joinPages(pages) {
    let text = '';
    const pageStarts = [];
    for (const lines of pages) {
      pageStarts.push(text.length);
      for (const line of lines) {
        if (/[A-Za-z]-$/.test(text) && /^[A-Za-z]/.test(line)) text = text.slice(0, -1) + line;
        else text += (text ? '\n' : '') + line;
      }
    }
    return { text, pageStarts };
  }

  function pageAt(pageStarts, offset) {
    if (!pageStarts || !pageStarts.length) return null;
    let page = 1;
    for (let i = 0; i < pageStarts.length; i++) if (pageStarts[i] <= offset) page = i + 1;
    return page;
  }

  const STRICT = /^(SECTION|SEC\.)\s+(\d+[A-Z]?)\.\s*(.*)$/;
  const RELAXED = /^(SECTION|SEC\.|Section|Sec\.)\s+(\d+[A-Za-z]?)\.\s*(.*)$/;
  const PART = /^(DIVISION|TITLE)\s+[A-Z0-9IVXLC]+\s*—/;

  // Splits bill text at its section headings ("SEC. 101. SHORT TITLE.").
  // Headings inside quoted amendment text start with a quote mark, so they never match.
  // Bills printed with capital "SEC." headings are split only on those, which skips the
  // mixed-case table of contents. Text with no headings is cut into numbered parts.
  function splitSections(text, pageStarts) {
    const lines = text.split('\n');
    const offsets = [];
    let at = 0;
    for (const line of lines) {
      offsets.push(at);
      at += line.length + 1;
    }
    const pattern = lines.some((l) => STRICT.test(l)) ? STRICT : RELAXED;
    const sections = [];
    let part = '';
    let current = null;
    let before = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (PART.test(line)) {
        part = line.length > 160 ? line.slice(0, 160) : line;
        continue;
      }
      const match = pattern.exec(line);
      if (match) {
        let header = match[3];
        let j = i;
        // A capitalized heading can wrap onto following lines until its closing period.
        while (!/\.$/.test(header) && j + 1 < lines.length && !/[a-z]/.test(lines[j + 1]) && header.length < 300) {
          j++;
          header += ' ' + lines[j];
        }
        current = {
          id: match[2],
          header: header.replace(/\.$/, '').trim(),
          part,
          page: pageAt(pageStarts, offsets[i]),
          lines: lines.slice(i, j + 1),
        };
        sections.push(current);
        i = j;
        continue;
      }
      if (current) current.lines.push(line);
      else before += line.length + 1;
    }

    if (!sections.length) return chunk(lines, offsets, pageStarts);

    // Same number twice: a tiny earlier copy is a table-of-contents line; otherwise keep both.
    const byId = new Map();
    const result = [];
    for (const s of sections.map(({ lines: l, ...rest }) => ({ ...rest, text: l.join('\n') }))) {
      const prior = byId.get(s.id);
      if (prior && prior.text.length < 300) {
        result.splice(result.indexOf(prior), 1, s);
        byId.set(s.id, s);
        continue;
      }
      if (prior) s.id = `${s.id}-${result.filter((r) => r.id.split('-')[0] === s.id).length + 1}`;
      byId.set(s.id, s);
      result.push(s);
    }
    return { sections: result, method: 'headings', skipped_chars: before };
  }

  function chunk(lines, offsets, pageStarts) {
    const sections = [];
    let buffer = [];
    let size = 0;
    let startLine = 0;
    const flush = () => {
      if (!buffer.length) return;
      const n = sections.length + 1;
      sections.push({ id: `part-${n}`, header: `Part ${n}`, part: '', page: pageAt(pageStarts, offsets[startLine]), text: buffer.join('\n') });
      buffer = [];
      size = 0;
    };
    lines.forEach((line, i) => {
      if (!buffer.length) startLine = i;
      buffer.push(line);
      size += line.length + 1;
      if (size >= CHUNK_CHARS) flush();
    });
    flush();
    return { sections: sections.filter((s) => s.text.trim()), method: 'chunks', skipped_chars: 0 };
  }

  // Full path from extracted pages to sections, with the limits the server enforces.
  function fromPages(pages) {
    const { text, pageStarts } = joinPages(pages.map(cleanPage));
    if (!text.trim()) throw new Error('No text found. A scanned PDF (an image of text) cannot be read.');
    if (text.length > MAX_CHARS) throw new Error('This bill is too long for the prototype (over 3 million characters).');
    const result = splitSections(text, pageStarts);
    if (result.sections.length > MAX_SECTIONS) throw new Error(`Found ${result.sections.length} sections; the limit is ${MAX_SECTIONS}.`);
    return { ...result, chars: text.length };
  }

  return { pageLines, cleanPage, joinPages, splitSections, fromPages, MAX_SECTIONS, MAX_CHARS };
});
