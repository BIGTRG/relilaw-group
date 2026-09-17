-- RELI application schema · migration 002 — learning links (M2)
-- The Core owns content, progress, scoring and credentials. The app keeps
-- only the IDENTIFIERS that tie an app user to their Core records, plus the
-- product catalogue that maps a sellable course code to a Core course.

-- What we sell. entitlement.key for a product is 'course:' || code.
create table product (
  code            text primary key,                 -- e.g. NC-ORG-001
  core_course_id  uuid not null unique,
  title           text not null,
  rank_code       text not null,                    -- presentation hint; the Core's rank is authoritative
  price_cents     integer not null check (price_cents >= 0),
  currency        text not null default 'usd',
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- app_user -> Core learner (one per user, created on first Dojo visit)
create table learner_link (
  user_id          uuid primary key references app_user(id) on delete cascade,
  core_learner_id  uuid not null unique,
  created_at       timestamptz not null default now()
);

-- app_user x Core course -> Core enrollment
create table enrollment_link (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references app_user(id) on delete cascade,
  core_course_id      uuid not null,
  core_enrollment_id  uuid not null unique,
  created_at          timestamptz not null default now(),
  unique (user_id, core_course_id)
);
create index enrollment_link_user_idx on enrollment_link (user_id);

-- attempts started by a user (so the result page can only show your own)
create table attempt_link (
  core_attempt_id     uuid primary key,
  user_id             uuid not null references app_user(id) on delete cascade,
  core_enrollment_id  uuid not null,
  core_assessment_id  uuid not null,
  created_at          timestamptz not null default now()
);
create index attempt_link_user_idx on attempt_link (user_id, created_at desc);

-- credentials issued to a user (public_ref is what /verify shows)
create table credential_link (
  core_credential_id  uuid primary key,
  user_id             uuid not null references app_user(id) on delete cascade,
  core_course_id      uuid not null,
  public_ref          text not null unique,
  issued_at           timestamptz not null default now()
);
create index credential_link_user_idx on credential_link (user_id);
