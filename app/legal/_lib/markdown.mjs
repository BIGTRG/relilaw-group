import 'server-only';
import fs from 'node:fs';
import path from 'node:path';

// A deliberately small Markdown subset for the legal documents: ATX headings
// (# to ###), paragraphs, dash lists, and nothing else. No raw HTML, no
// inline markup, so a document can never inject markup into the page.
// Anything the parser does not recognise is rendered as a paragraph.

const ROOT = path.join(process.cwd(), 'content', 'legal');

export function readLegalMarkdown(slug) {
  if (!/^[a-z-]+$/.test(slug)) throw new Error('bad legal slug');
  return fs.readFileSync(path.join(ROOT, `${slug}.md`), 'utf8');
}

/** Parse into a flat block list: {type:'h', level, text} | {type:'p', text} | {type:'ul', items:[]} */
export function parseBlocks(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { blocks.push({ type: 'p', text: para.join(' ') }); para = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { flushPara(); flushList(); blocks.push({ type: 'h', level: h[1].length, text: h[2].trim() }); continue; }
    const li = /^-\s+(.*)$/.exec(line);
    if (li) { flushPara(); if (!list) list = { type: 'ul', items: [] }; list.items.push(li[1].trim()); continue; }
    if (line.trim() === '') { flushPara(); flushList(); continue; }
    if (list) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    para.push(line.trim());
  }
  flushPara(); flushList();
  return blocks;
}

/** Title (first h1) and the effective/revised lines, for metadata and the header. */
export function documentMeta(blocks) {
  const title = blocks.find((b) => b.type === 'h' && b.level === 1)?.text ?? 'Legal';
  const dates = blocks.filter((b) => b.type === 'p' && /^(Effective date|Last revised):/.test(b.text)).map((b) => b.text);
  return { title, dates };
}

/** Deterministic id for a heading, used for the table of contents. */
export function headingId(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
