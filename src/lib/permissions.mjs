// The permission matrix from the specification §2, implemented exactly.
// Roles are the eight from role_grant. Capabilities are checked ONLY through
// can(); no route hand-rolls a role test.

export const ROLES = Object.freeze([
  'learner', 'employee', 'org_admin', 'instructor',
  'author', 'legal', 'staff', 'auditor',
]);

// capability -> set of roles that hold it. Transcribed from the spec table.
const MATRIX = Object.freeze({
  take_course:            new Set(['learner', 'employee', 'org_admin', 'instructor', 'author', 'legal', 'staff']),
  earn_rank:              new Set(['learner', 'org_admin', 'instructor', 'author', 'legal', 'staff']),
  assign_seats:           new Set(['org_admin', 'staff']),
  see_org_report:         new Set(['org_admin', 'staff', 'auditor']),
  grade_portfolio:        new Set(['instructor', 'staff']),
  draft_content:          new Set(['instructor', 'author', 'legal', 'staff']),
  // The bolded row. Only legal. Not staff. No override exists, and the
  // database role layer (db/roles.sql) enforces it even against this file.
  publish_jurisdiction_content: new Set(['legal']),
  change_price_or_entitlement:  new Set(['staff']),
  revoke_credential:            new Set(['staff']),
  read_everything:              new Set(['auditor']),
});

export const CAPABILITIES = Object.freeze(Object.keys(MATRIX));

// Which doors a role may enter (§2). One account, three front doors.
export const DOORS = Object.freeze({
  dojo:    new Set(['learner', 'employee', 'org_admin']),
  studio:  new Set(['author', 'legal', 'instructor']),
  console: new Set(['staff', 'auditor']), // partner is phase 2
});

// Doors on which MFA is mandatory.
export const MFA_REQUIRED_DOORS = Object.freeze(new Set(['studio', 'console']));

/** roles: array of active role names for the session. */
export function can(roles, capability) {
  const allowed = MATRIX[capability];
  if (!allowed) throw new Error(`unknown capability: ${capability}`);
  // Auditor is read-only everywhere: holding auditor grants no write capability,
  // and mixing auditor with another role must not silently widen auditor
  // sessions — write capabilities come from the other role only.
  return roles.some(r => allowed.has(r));
}

export function canEnterDoor(roles, door) {
  const allowed = DOORS[door];
  if (!allowed) throw new Error(`unknown door: ${door}`);
  return roles.some(r => allowed.has(r));
}

/** True when every active role is auditor — such a session may never write. */
export function isReadOnlySession(roles) {
  return roles.length > 0 && roles.every(r => r === 'auditor');
}
