-- RELI application schema · migration 001
-- App-side data only. Content, progress, assessment scoring and credentials
-- live in the Learning Core and are never duplicated here.

create extension if not exists pgcrypto;
create extension if not exists citext;

------------------------------------------------------------------- identity

create table app_user (
  id            uuid primary key default gen_random_uuid(),
  -- Permanent, opaque, minted at signup, upserted into the Core as the
  -- learner's external_ref. NEVER an email. NEVER changes (trigger below).
  external_ref  text not null unique,
  email         citext not null unique,
  email_verified_at timestamptz,
  display_name  text not null,
  status        text not null default 'active'
                check (status in ('active','suspended','deleted')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function forbid_external_ref_change() returns trigger
language plpgsql as $$
begin
  if new.external_ref is distinct from old.external_ref then
    raise exception 'external_ref is permanent and cannot change';
  end if;
  return new;
end $$;

create trigger app_user_external_ref_frozen
  before update on app_user
  for each row execute function forbid_external_ref_change();

create table password_credential (
  user_id     uuid primary key references app_user(id) on delete cascade,
  argon2_hash text not null,
  updated_at  timestamptz not null default now()
);

create table passkey_credential (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references app_user(id) on delete cascade,
  credential_id bytea not null unique,
  public_key    bytea not null,
  counter       bigint not null default 0,
  transports    text[] not null default '{}',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create table totp_secret (
  user_id      uuid primary key references app_user(id) on delete cascade,
  secret_enc   bytea not null,          -- encrypted at rest with app KEK
  confirmed_at timestamptz,
  created_at   timestamptz not null default now()
);

create table recovery_code (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references app_user(id) on delete cascade,
  code_hash text not null,
  used_at   timestamptz
);

-- Eight roles, exact vocabulary from the spec (§2).
create table role_grant (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references app_user(id) on delete cascade,
  role       text not null check (role in
             ('learner','employee','org_admin','instructor','author','legal','staff','auditor')),
  org_id     uuid,                       -- employee/org_admin scope; null = global
  granted_by uuid references app_user(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index role_grant_user_idx on role_grant(user_id) where revoked_at is null;

------------------------------------------------------------------- commerce

create table stripe_customer (
  user_id            uuid primary key references app_user(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at         timestamptz not null default now()
);

-- Webhook idempotency ledger: one row per Stripe event.id, processed once.
create table stripe_event (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  payload      jsonb not null
);

-- THE KEYSTONE (§3). Access checks read key + dates only; `source` records why.
create table entitlement (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references app_user(id) on delete cascade,
  org_id        uuid,
  key           text not null,
  source        text not null,   -- purchase:sub_1234 · seat:org_88 · comp:staff · promo:x · grandfather:2026
  granted_at    timestamptz not null default now(),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  revoke_reason text
);
create index entitlement_check_idx on entitlement(user_id, key)
  where revoked_at is null;

----------------------------------------------------- content pipeline (app side)

-- Outstanding attorney-review items that block publication of a Core course.
create table review_item (
  id          uuid primary key default gen_random_uuid(),
  core_course_ref text not null,        -- e.g. NC-ORG-001
  title       text not null,
  detail      text,
  status      text not null default 'open' check (status in ('open','resolved')),
  opened_by   uuid references app_user(id),
  opened_at   timestamptz not null default now(),
  resolved_by uuid references app_user(id),
  resolved_at timestamptz
);
create index review_item_open_idx on review_item(core_course_ref) where status = 'open';

-- The legal gate, enforced at the DATABASE ROLE level (db/roles.sql):
-- only the reli_legal role holds INSERT on this table. The application role
-- physically cannot write a sign-off. No UPDATE or DELETE for anyone: append-only.
create table publish_signoff (
  id               uuid primary key default gen_random_uuid(),
  core_course_ref  text not null,
  core_version_ref text not null,
  reviewer_user_id uuid not null references app_user(id),
  reviewer_role    text not null default 'legal' check (reviewer_role = 'legal'),
  signed_at        timestamptz not null default now(),
  note             text,
  unique (core_course_ref, core_version_ref)
);

-- Append-only audit trail for every pipeline transition and privileged action.
create table audit_event (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  actor_user_id uuid,
  actor_role    text,
  action        text not null,
  object_type   text,
  object_ref    text,
  from_state    text,
  to_state      text,
  reason        text,
  ip            inet,
  meta          jsonb
);

------------------------------------------------------------------- mail log

create table email_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references app_user(id),
  to_email   citext not null,
  template   text not null,
  subject    text not null,
  message_id text,
  status     text not null default 'queued' check (status in ('queued','sent','failed')),
  sent_at    timestamptz,
  created_at timestamptz not null default now()
);

--------------------------------------------------- MODEL ONLY · phase 2 (§7)

create table org (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table seat (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references org(id) on delete cascade,
  user_id         uuid references app_user(id),
  entitlement_key text not null,
  assigned_at     timestamptz,
  released_at     timestamptz
);

create table org_group (
  id     uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id) on delete cascade,
  name   text not null
);

create table org_group_member (
  group_id uuid not null references org_group(id) on delete cascade,
  user_id  uuid not null references app_user(id) on delete cascade,
  primary key (group_id, user_id)
);

create table assignment_rule (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references org(id) on delete cascade,
  group_id   uuid references org_group(id),
  course_key text not null,
  due_days   integer,
  created_at timestamptz not null default now()
);

------------------------------------------- MODEL ONLY · Living Law, phase 3 (§4.3)

create table jurisdiction (
  id   uuid primary key default gen_random_uuid(),
  code text not null unique,             -- 'NC'
  name text not null
);

create table law_item (
  id              uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdiction(id),
  citation        text not null,         -- '§ 95-25.8'
  title           text not null,
  summary         text,
  effective_date  date,
  verified_on     date,
  verified_by     uuid references app_user(id)
);

create table law_citation (
  id              uuid primary key default gen_random_uuid(),
  law_item_id     uuid not null references law_item(id) on delete cascade,
  core_lesson_ref text not null
);

create table change_event (
  id          uuid primary key default gen_random_uuid(),
  law_item_id uuid not null references law_item(id) on delete cascade,
  kind        text not null,             -- amendment · repeal · new · reinterpretation
  detail      text,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution  text
);
