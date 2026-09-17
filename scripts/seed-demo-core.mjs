// Seed the DEMO tenant of the Learning Core with a RELI-shaped sample course so
// the learner surfaces can be exercised end to end before any reviewed content
// exists. SAMPLE content only: every title says so. Never run against the
// production (reli) provider.
//
//   CORE_BASE_URL=https://engine.geniuseye.ai/v1/learningcore-demo/ \
//   CORE_API_KEY=<relilaw engine token> node scripts/seed-demo-core.mjs
import { createCoreClient } from '../src/lib/core-client.mjs';

const RANKS = [
  ['White', '#D8DCE0'], ['Yellow', '#E6C229'], ['Orange', '#CC6B2C'], ['Green', '#3E7D5C'],
  ['Blue', '#2C6FA8'], ['Purple', '#6A5090'], ['Brown', '#6B4A33'], ['Black', '#1B242C'], ['Sensei', '#B8863B'],
];

const LESSONS = [
  [1, 'Who is an employee in North Carolina', 'Employee, contractor, and the tests that decide it.', 9, [
    { type: 'prose', text: 'SAMPLE. Before any wage, leave or termination rule applies, the first question is whether the worker is an employee at all. North Carolina and federal agencies use different tests and can reach different answers for the same person.' },
    { type: 'list', items: ['Economic reality test for federal wage law.', 'Right-to-control factors for state purposes.', 'A signed contractor agreement does not settle the question.'] },
    { type: 'trap', text: 'Calling someone a contractor in the paperwork while directing their hours, tools and methods is the most common misclassification pattern surveyed.' },
  ], [['N.C. Gen. Stat. § 95-25.2 (definitions)', '2026-08-11'], ['29 U.S.C. § 203 (FLSA definitions)', '2026-08-11']]],
  [1, 'Required postings and records', 'What must be on the wall and in the file.', 7, [
    { type: 'prose', text: 'SAMPLE. Employers must display specific state and federal notices and keep wage records for a defined period.' },
    { type: 'list', items: ['State wage and hour notice.', 'Federal FLSA, EEO, FMLA (if covered) and OSHA notices.', 'Payroll records retained per statute.'] },
    { type: 'trap', text: 'Remote-first employers often forget that electronic posting has conditions; a PDF in a shared drive nobody opens is not a posting.' },
  ], [['N.C. Gen. Stat. § 95-25.13 (notification, posting, records)', '2026-08-11']]],
  [2, 'Minimum wage and overtime basics', 'Rates, workweeks and who is exempt.', 10, [
    { type: 'prose', text: 'SAMPLE. North Carolina follows the federal minimum wage. Overtime is owed after 40 hours in a workweek unless an exemption genuinely applies.' },
    { type: 'list', items: ['Define the workweek in writing and keep it fixed.', 'Salary alone does not make a worker exempt.', 'Duties tests decide exemption.'] },
    { type: 'trap', text: 'Averaging hours across two weeks to avoid overtime is not permitted for non-exempt employees.' },
  ], [['N.C. Gen. Stat. § 95-25.3, § 95-25.4', '2026-08-11'], ['29 C.F.R. Part 541', '2026-08-11']]],
  [2, 'Final pay and deductions', 'Timing of the last check and what may be withheld.', 8, [
    { type: 'prose', text: 'SAMPLE. When an employee leaves, final wages are due on or before the next regular payday. The employer does not set the timeline.' },
    { type: 'list', items: ['Final wages due by the next regular payday.', 'Commissions and bonuses due when calculable.', 'Deductions require written, specific authorization.'] },
    { type: 'trap', text: 'Withholding the final check until equipment is returned is unlawful without a specific signed deduction authorization. A handbook policy is not enough.' },
  ], [['N.C. Gen. Stat. § 95-25.7', '2026-08-11'], ['N.C. Gen. Stat. § 95-25.8', '2026-08-11']]],
  [3, 'Discipline and documentation', 'Consistency, records and the at-will boundary.', 9, [
    { type: 'prose', text: 'SAMPLE. North Carolina is an at-will state, but at-will is a default, not a shield. Consistent, documented discipline is what an employer relies on when a decision is questioned.' },
    { type: 'list', items: ['Apply the same rule the same way.', 'Record the facts, the rule and the decision at the time.', 'Public policy and statutory exceptions still apply.'] },
    { type: 'trap', text: 'Writing the documentation after the complaint arrives, dated as if contemporaneous, converts a defensible decision into an indefensible one.' },
  ], [['N.C. Gen. Stat. § 95-241 (REDA)', '2026-08-11']]],
  [3, 'Separation checklist', 'The last day, done correctly.', 6, [
    { type: 'prose', text: 'SAMPLE. A separation touches pay, benefits notices, property, access and records at once. A checklist is the difference between a clean exit and a claim.' },
    { type: 'list', items: ['Final pay scheduled to the next regular payday.', 'Continuation-of-coverage notices where applicable.', 'Access revoked, property logged, file closed.'] },
    { type: 'trap', text: 'Conditioning the final paycheck on signing a release is not permitted; a release must be supported by something extra.' },
  ], [['N.C. Gen. Stat. § 95-25.7', '2026-08-11'], ['29 U.S.C. § 1161 (COBRA)', '2026-08-11']]],
];

async function main() {
  const core = createCoreClient();
  const req = core._internals.request;

  let schemes = (await req('GET', '/v1/schemes')).items;
  let scheme = schemes.find(s => s.name === 'RELI Rank Ladder v1 (sample)');
  if (!scheme) {
    scheme = await req('POST', '/v1/schemes', {
      body: { name: 'RELI Rank Ladder v1 (sample)', ranks: RANKS.map(([name, fill], i) => ({ name, position: i + 1, meta: { fill, code: name.toLowerCase() } })) },
      idempotencyKey: 'demo-scheme-v1',
    });
  }
  const orange = scheme.ranks.find(r => r.name === 'Orange');

  const courses = (await req('GET', '/v1/courses')).data;
  let course = courses.find(c => c.title.startsWith('SAMPLE · NC Employment Law'));
  if (!course) {
    course = await req('POST', '/v1/courses', {
      body: {
        title: 'SAMPLE · NC Employment Law — Orange Belt',
        summary: 'Sample course for staging. Not reviewed. Not published to real learners.',
        scheme_id: scheme.id, rank_id: orange.id, status: 'published',
        modules: [
          { title: 'Module 1 · Who is covered', position: 1 },
          { title: 'Module 2 · Wages', position: 2 },
          { title: 'Module 3 · Discipline and separation', position: 3 },
        ],
      },
      idempotencyKey: 'demo-course-v1',
    });
    let pos = 1;
    for (const [mod, title, summary, mins, blocks, cites] of LESSONS) {
      await req('POST', `/v1/courses/${course.id}/lessons`, {
        body: { title, summary, position: pos, module_position: mod, est_minutes: mins, status: 'published', blocks,
          citations: cites.map(([authority, verified_on]) => ({ authority, verified_on })) },
        idempotencyKey: `demo-lesson-${pos}`,
      });
      pos++;
    }
    await req('POST', '/v1/assessments', {
      body: {
        course_id: course.id, title: 'SAMPLE · Orange Belt assessment', pass_percent: 80, status: 'published', max_attempts: 3,
        items: [
          { position: 1, kind: 'single', points: 1, prompt: [{ type: 'prose', text: 'Final wages for a separated employee are due:' }],
            options: [{ id: 'a', text: 'Within 72 hours' }, { id: 'b', text: 'On or before the next regular payday' }, { id: 'c', text: 'Within 30 days' }], answer_key: ['b'] },
          { position: 2, kind: 'multi', points: 2, prompt: [{ type: 'prose', text: 'Which of these make a wage deduction lawful in North Carolina? Select all that apply.' }],
            options: [{ id: 'a', text: 'A handbook policy' }, { id: 'b', text: 'A written authorization naming the amount' }, { id: 'c', text: 'A court order' }], answer_key: ['b', 'c'] },
          { position: 3, kind: 'single', points: 1, prompt: [{ type: 'prose', text: 'A worker paid a salary is:' }],
            options: [{ id: 'a', text: 'Always exempt from overtime' }, { id: 'b', text: 'Exempt only if the duties test is also met' }, { id: 'c', text: 'Never exempt' }], answer_key: ['b'] },
          { position: 4, kind: 'single', points: 1, prompt: [{ type: 'prose', text: 'Averaging hours across two workweeks to avoid overtime is:' }],
            options: [{ id: 'a', text: 'Permitted with consent' }, { id: 'b', text: 'Not permitted for non-exempt employees' }], answer_key: ['b'] },
          { position: 5, kind: 'single', points: 1, prompt: [{ type: 'prose', text: 'Conditioning the final paycheck on signing a release is:' }],
            options: [{ id: 'a', text: 'Standard practice' }, { id: 'b', text: 'Not permitted' }], answer_key: ['b'] },
        ],
      },
      idempotencyKey: 'demo-assessment-v1',
    });
  }
  const full = await req('GET', `/v1/courses/${course.id}`);
  console.log(JSON.stringify({ scheme: scheme.id, course: course.id, lessons: full.lessons.length, assessments: full.assessments.map(a => a.id) }));
}

main().catch(e => { console.error(e.message, e.problem || ''); process.exit(1); });
