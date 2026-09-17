// Usage billing — PHASE 2 STUB (§8, Billing Meters).
//
// When usage-based pricing arrives (seat-hours, API calls for a partner
// tenant) it is billed with Stripe **Billing Meters**:
//   billing.meters.create → billing.meterEvents.create({ event_name, payload })
//   and a metered Price bound to the meter.
// The legacy `subscription_item.usage_records` API was REMOVED in
// 2025-03-31.basil. Any tutorial that shows it is dead; do not follow it.
//
// Nothing here is wired into a route. It exists so the shape is agreed before
// phase 2 and so nobody reaches for usage_records in the meantime.

export class UsageBillingNotAvailable extends Error {
  constructor() { super('usage billing is phase 2 (Stripe Billing Meters); not available in phase 1'); this.name = 'UsageBillingNotAvailable'; }
}

/** @deprecated-until-phase-2 */
export async function recordUsage(/* { stripe, eventName, customerId, value } */) {
  throw new UsageBillingNotAvailable();
}
