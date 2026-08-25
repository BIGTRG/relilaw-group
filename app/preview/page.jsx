import { LessonBlock, Sources } from '@/components/LessonBlocks';

// A production-markup lesson rendered from typed blocks — exactly the shapes
// the Core returns. This page exists so the lesson design can be approved
// against real components; it carries clearly-labelled sample content.
const BLOCKS = [
  { type: 'prose', text: 'When an employee leaves — quits, is fired, or is laid off — North Carolina sets specific rules for the final paycheck. The employer does not get to decide the timeline.' },
  { type: 'list', items: [
    'Final wages are due on or before the next regular payday.',
    'Commissions and bonuses are due when they can be calculated.',
    'Deductions require written authorization that names an amount.'] },
  { type: 'trap', text: 'Employers often withhold the final check until equipment is returned. In North Carolina that is unlawful without a specific, signed deduction authorization — a policy in the handbook is not enough.' },
];
const CITATIONS = [
  { name: 'N.C. Gen. Stat. § 95-25.7 — Payment to separated employees', ref: 'NCGS 95-25.7', verifiedOn: '2026-08-11', reviewer: 'sample' },
  { name: 'N.C. Gen. Stat. § 95-25.8 — Withholding of wages', ref: 'NCGS 95-25.8', verifiedOn: '2026-08-11', reviewer: 'sample', stale: false },
];

export default function LessonPreview() {
  return (
    <div className="reading">
      <div className="section-head">
        <span className="badge badge-warn">Sample lesson — for design approval, not published content</span>
        <p className="eyebrow">Module 4 · Lesson 3</p>
        <h1>Final pay and deductions</h1>
      </div>
      <div className="lesson">
        {BLOCKS.map((b, i) => <LessonBlock key={i} block={b} />)}
        <Sources citations={CITATIONS} />
      </div>
    </div>
  );
}
