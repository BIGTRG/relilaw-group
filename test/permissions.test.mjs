import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  can, canEnterDoor, isReadOnlySession, ROLES, CAPABILITIES, MFA_REQUIRED_DOORS,
} from '../src/lib/permissions.mjs';

// The spec table, row by row. ● = true, — = false. If this test and
// permissions.mjs ever disagree, the spec wins.
const SPEC = {
  take_course:                  ['learner','employee','org_admin','instructor','author','legal','staff'],
  earn_rank:                    ['learner','org_admin','instructor','author','legal','staff'],
  assign_seats:                 ['org_admin','staff'],
  see_org_report:               ['org_admin','staff','auditor'],
  grade_portfolio:              ['instructor','staff'],
  draft_content:                ['instructor','author','legal','staff'],
  publish_jurisdiction_content: ['legal'],
  change_price_or_entitlement:  ['staff'],
  revoke_credential:            ['staff'],
  read_everything:              ['auditor'],
};

test('matrix matches the specification exactly, all 80 cells', () => {
  for (const capability of Object.keys(SPEC)) {
    for (const role of ROLES) {
      const expected = SPEC[capability].includes(role);
      assert.equal(
        can([role], capability), expected,
        `${role} × ${capability} should be ${expected}`,
      );
    }
  }
  assert.deepEqual([...CAPABILITIES].sort(), [...Object.keys(SPEC)].sort());
});

test('staff cannot publish jurisdiction content — the bolded row', () => {
  assert.equal(can(['staff'], 'publish_jurisdiction_content'), false);
  assert.equal(can(['staff', 'author', 'instructor'], 'publish_jurisdiction_content'), false);
  assert.equal(can(['legal'], 'publish_jurisdiction_content'), true);
});

test('multi-role sessions take the union of their roles', () => {
  assert.equal(can(['learner', 'instructor'], 'grade_portfolio'), true);
  assert.equal(can(['learner', 'instructor'], 'assign_seats'), false);
});

test('auditor-only sessions are read-only', () => {
  assert.equal(isReadOnlySession(['auditor']), true);
  assert.equal(isReadOnlySession(['auditor', 'staff']), false);
  for (const c of CAPABILITIES.filter(c => c !== 'read_everything' && c !== 'see_org_report')) {
    assert.equal(can(['auditor'], c), false, `auditor must not hold ${c}`);
  }
});

test('doors admit the right roles and demand MFA where required', () => {
  assert.equal(canEnterDoor(['learner'], 'dojo'), true);
  assert.equal(canEnterDoor(['learner'], 'studio'), false);
  assert.equal(canEnterDoor(['legal'], 'studio'), true);
  assert.equal(canEnterDoor(['staff'], 'console'), true);
  assert.equal(canEnterDoor(['learner'], 'console'), false);
  assert.deepEqual([...MFA_REQUIRED_DOORS].sort(), ['console', 'studio']);
});

test('unknown capabilities and doors throw, never default-allow', () => {
  assert.throws(() => can(['staff'], 'force_publish'));
  assert.throws(() => canEnterDoor(['staff'], 'backdoor'));
});
