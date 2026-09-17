// Constructed-response grading, phase 1 (spec section 5, "Assessment").
//
// The Core stores each constructed item's model elements in answer_key as
//   [{ element: "...", citation: "...", keywords?: ["..."] }]
// and has no automatic element matching: it parks the attempt at
// needs_grading and expects per-item points through POST /v1/attempts/:id/grade.
//
// This module is that grader. It is DETERMINISTIC and EXPLICIT so it can be
// tested and explained to a reviewer:
//
//   1. Every element is scored 0 or 1. Points for the item = number of
//      elements matched, capped at the item's points.
//   2. An element's TERMS are its `keywords` when the author supplied them,
//      otherwise the content words of the element text (stop words removed,
//      light stemming, number words normalised to digits, statute symbols
//      normalised) MINUS any word that already appears in the prompt. A
//      learner restating the question earns nothing.
//   3. A term shared with a sibling element of the same item is worth
//      SHARED_WEIGHT (half a hit); a term unique to the element is one hit.
//      A sentence about one element therefore cannot bleed into its
//      neighbour through shared vocabulary alone.
//   4. An element is matched when the weighted hits reach
//      max(MIN_HITS, ceil(HIT_RATIO * terms)).
//
// It never sees the answer key on the client; the caller fetches the key with
// the Core admin scope on the server and passes it in. Nothing here decides
// pass/fail: the Core finalises the score and the pass mark.

export const MIN_HITS = 3;
export const HIT_RATIO = 0.25;
export const SHARED_WEIGHT = 0.5;

const STOP = new Set(`
a an the and or but if then than so of to in on at by for from with without into onto over under
is are was were be been being am do does did done has have had having will would shall should may
might must can could not no nor only also as it its this that these those there here their they
them he she his her him we us our you your i me my who whom whose which what when where why how
all any each every both either neither some such very more most much many few less least own same
other another again further once about above below between before after during within because
while until unless whether per via etc via ie eg
`.split(/\s+/).filter(Boolean));

// The stop list deliberately keeps "before", "after", "within" OUT of the
// exclusion when they carry legal meaning next to a number; they are removed
// as bare words only. Numbers are always kept.
STOP.delete('before'); STOP.delete('after'); STOP.delete('within');

const NUMBER_WORDS = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  ten: '10', eleven: '11', twelve: '12', fifteen: '15', twenty: '20', thirty: '30', forty: '40',
  fifty: '50', sixty: '60', ninety: '90', hundred: '100',
};

/** Lower-case, unify quotes/dashes, normalise statute symbols, keep word chars. */
export function normalise(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00a7+/g, ' section ')
    .replace(/u\.s\.c\./g, 'usc')
    .replace(/n\.c\. gen\. stat\./g, 'ncgs')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/'s\b/g, '')
    .replace(/[^a-z0-9\-\.\s]/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Light, predictable stemming: plurals, -ing, -ed, -ly, -tion/-sion kept. */
export function stem(word) {
  let w = word;
  if (NUMBER_WORDS[w]) return NUMBER_WORDS[w];
  if (/^\d/.test(w)) return w.replace(/\.$/, '');
  if (w.length > 5 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 4 && w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 5 && w.endsWith('ly')) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1); // notice/notic, require/requir
  return w;
}

/** Distinct stems of the content words in a text. */
export function stems(text) {
  const out = new Set();
  for (const raw of normalise(text).split(' ')) {
    const w = raw.replace(/^-+|-+$/g, '');
    if (!w || STOP.has(w)) continue;
    if (w.length < 3 && !/^\d/.test(w)) continue;
    out.add(stem(w));
    // hyphenated compounds also contribute their parts (non-overtime -> overtime)
    if (w.includes('-')) for (const part of w.split('-')) if (part.length >= 3 && !STOP.has(part)) out.add(stem(part));
  }
  return out;
}

const sourceOf = element => (Array.isArray(element.keywords) && element.keywords.length
  ? element.keywords.join(' ')
  : element.element);

/** The terms a response must hit for one element: [{ term, weight }].
 *  Prompt words never count; words shared with a sibling element weigh half. */
export function termsFor(element, promptText = '', siblings = []) {
  const prompt = stems(promptText);
  const shared = new Set();
  for (const sib of siblings) {
    if (sib === element) continue;
    for (const t of stems(sourceOf(sib))) shared.add(t);
  }
  const own = [...stems(sourceOf(element))];
  let terms = own.filter(t => !prompt.has(t));
  // If the prompt swallowed nearly everything (degenerate authoring), fall
  // back to the element's own words so the element is still earnable.
  if (terms.length < MIN_HITS) terms = own;
  return terms.map(term => ({ term, weight: shared.has(term) ? SHARED_WEIGHT : 1 }));
}

/** Score one element against a response: { matched, hits, needed, terms }. */
export function matchElement(element, response, promptText = '', siblings = []) {
  const terms = termsFor(element, promptText, siblings);
  const have = stems(response);
  const hits = terms.reduce((sum, t) => sum + (have.has(t.term) ? t.weight : 0), 0);
  const needed = Math.min(terms.length, Math.max(MIN_HITS, Math.ceil(HIT_RATIO * terms.length)));
  return { matched: terms.length > 0 && hits >= needed, hits, needed, terms: terms.length };
}

/** Plain text of an item prompt (typed blocks). */
export function promptText(prompt) {
  return (prompt ?? []).map(b => {
    if (b.type === 'list') return (b.items ?? []).join(' ');
    if (b.type === 'table') return [...(b.head ?? []), ...(b.rows ?? []).flat()].join(' ');
    return b.text ?? '';
  }).join(' ');
}

/**
 * Grade every constructed item of an attempt.
 *   items:     the learner-facing assessment items (id, kind, points, prompt)
 *   answerKey: Core answer-key rows (id, kind, points, answer_key)
 *   answers:   [{ item_id, response }] as submitted (response string or [string])
 * Returns { grades: [{ item_id, points_awarded }], detail: [{ item_id, points, points_awarded, elements: [bool] }] }
 * Only constructed items appear; the Core scores single/multi itself.
 */
export function gradeConstructed({ items, answerKey, answers }) {
  const keyBy = new Map(answerKey.map(k => [k.id, k]));
  const respBy = new Map(answers.map(a => [a.item_id, Array.isArray(a.response) ? a.response.join('\n') : String(a.response ?? '')]));
  const grades = [];
  const detail = [];
  for (const it of items) {
    if (it.kind !== 'constructed') continue;
    const key = keyBy.get(it.id);
    const elements = Array.isArray(key?.answer_key) ? key.answer_key : [];
    const response = respBy.get(it.id) ?? '';
    const prompt = promptText(it.prompt);
    const matched = elements.map(el => response.trim() ? matchElement(el, response, prompt, elements).matched : false);
    const points_awarded = Math.min(Number(it.points), matched.filter(Boolean).length);
    grades.push({ item_id: it.id, points_awarded });
    detail.push({ item_id: it.id, points: Number(it.points), points_awarded, elements: matched });
  }
  return { grades, detail };
}
