-- RELI application schema · migration 003 — the content pipeline (Console
-- module 05, Studio) and the credential registry's revocation record.
--
--   draft -> sme_review -> legal_review -> published
--
-- The state machine is enforced HERE, in SQL, as well as in code. The
-- application role (reli_app) can move a version through the first three
-- states; it physically cannot reach `published` because doing so requires a
-- publish_signoff row, and only reli_legal holds INSERT on that table
-- (db/roles.sql). A published version is frozen by trigger. The transition
-- log is append-only: no role holds UPDATE or DELETE on it.

------------------------------------------------------------- content_version

create table content_version (
  id               uuid primary key default gen_random_uuid(),
  core_course_ref  text not null,                 -- product code, e.g. NC-ORG-001
  core_version_ref text not null,                 -- opaque version label, e.g. v1
  title            text not null default '',
  state            text not null default 'draft'
                   check (state in ('draft','sme_review','legal_review','published')),
  created_by       uuid references app_user(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  published_at     timestamptz,
  unique (core_course_ref, core_version_ref)
);
create index content_version_state_idx on content_version (state, updated_at desc);

--------------------------------------------------------- pipeline_transition

create table pipeline_transition (
  id             bigint generated always as identity primary key,
  version_id     uuid not null references content_version(id),
  from_state     text,
  to_state       text not null
                 check (to_state in ('draft','sme_review','legal_review','published')),
  actor_user_id  uuid references app_user(id),
  actor_role     text not null,
  reason         text,
  at             timestamptz not null default now()
);
create index pipeline_transition_version_idx on pipeline_transition (version_id, at);

------------------------------------------------------------------ the gate

-- True when the version may become published: a legal sign-off exists for
-- exactly this (course, version) AND no attorney-review item is open for the
-- course. Read-only; safe for any role that can read the two tables.
create or replace function pipeline_publishable(p_version_id uuid) returns boolean
language sql stable as $$
  select exists (
           select 1 from content_version v
             join publish_signoff s
               on s.core_course_ref = v.core_course_ref
              and s.core_version_ref = v.core_version_ref
            where v.id = p_version_id)
     and not exists (
           select 1 from content_version v
             join review_item r on r.core_course_ref = v.core_course_ref
            where v.id = p_version_id and r.status = 'open');
$$;

-- Every transition must be legal for the machine, and `published` must pass
-- the gate. from_state must match the version's current state so the log can
-- never disagree with the version.
create or replace function pipeline_transition_guard() returns trigger
language plpgsql as $$
declare
  cur text;
begin
  select state into cur from content_version where id = new.version_id for update;
  if cur is null then
    raise exception 'unknown content_version %', new.version_id;
  end if;
  if new.from_state is distinct from cur then
    raise exception 'transition from % does not match current state %', new.from_state, cur;
  end if;
  if cur = 'published' then
    raise exception 'a published version is immutable';
  end if;
  if not (
       (cur = 'draft'        and new.to_state = 'sme_review')
    or (cur = 'sme_review'   and new.to_state in ('legal_review', 'draft'))
    or (cur = 'legal_review' and new.to_state in ('published', 'draft'))
  ) then
    raise exception 'illegal transition % -> %', cur, new.to_state;
  end if;
  if new.to_state = 'published' then
    if new.actor_role <> 'legal' then
      raise exception 'only a legal reviewer can publish jurisdiction content';
    end if;
    if not pipeline_publishable(new.version_id) then
      raise exception 'GATE: version % has no legal sign-off or has open review items', new.version_id;
    end if;
  end if;
  return new;
end $$;

create trigger pipeline_transition_guard
  before insert on pipeline_transition
  for each row execute function pipeline_transition_guard();

-- The version row itself: state can only change to a value the log has just
-- recorded, `published` is checked against the gate again, and a published
-- version is frozen (state, refs, title all immutable).
create or replace function content_version_guard() returns trigger
language plpgsql as $$
begin
  if old.state = 'published' then
    raise exception 'a published version is immutable';
  end if;
  if new.core_course_ref <> old.core_course_ref or new.core_version_ref <> old.core_version_ref then
    raise exception 'version references are immutable';
  end if;
  if new.state is distinct from old.state then
    -- the log must already carry this exact step, written in this transaction
    if not exists (
      select 1 from pipeline_transition t
       where t.version_id = old.id and t.from_state = old.state and t.to_state = new.state
         and t.at >= now() - interval '5 minutes') then
      raise exception 'state change without a matching pipeline_transition';
    end if;
    if new.state = 'published' then
      if not pipeline_publishable(old.id) then
        raise exception 'GATE: version % has no legal sign-off or has open review items', old.id;
      end if;
      new.published_at := coalesce(new.published_at, now());
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger content_version_guard
  before update on content_version
  for each row execute function content_version_guard();

create or replace function content_version_no_delete() returns trigger
language plpgsql as $$
begin
  if old.state = 'published' then
    raise exception 'a published version is immutable';
  end if;
  return old;
end $$;

create trigger content_version_no_delete
  before delete on content_version
  for each row execute function content_version_no_delete();

-- A sign-off must point at a version that is actually in legal review. This
-- closes the "sign off a draft nobody has read" hole even for reli_legal.
create or replace function publish_signoff_guard() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from content_version v
     where v.core_course_ref = new.core_course_ref
       and v.core_version_ref = new.core_version_ref
       and v.state = 'legal_review') then
    raise exception 'sign-off refused: % % is not in legal review', new.core_course_ref, new.core_version_ref;
  end if;
  if exists (select 1 from review_item r where r.core_course_ref = new.core_course_ref and r.status = 'open') then
    raise exception 'sign-off refused: open attorney-review items remain for %', new.core_course_ref;
  end if;
  if new.reviewer_role <> 'legal' then
    raise exception 'sign-off refused: reviewer must hold the legal role';
  end if;
  return new;
end $$;

create trigger publish_signoff_guard
  before insert on publish_signoff
  for each row execute function publish_signoff_guard();

----------------------------------------------- credential registry (module 07)

-- The Core has no revoke endpoint yet; the registry records revocation here
-- and the public verify page overlays it. When the Core gains one, the same
-- columns record the mirror.
alter table credential_link
  add column revoked_at    timestamptz,
  add column revoke_reason text,
  add column revoked_by    uuid references app_user(id);

-- Revocation is one-way: once set it cannot be cleared or re-worded.
create or replace function credential_link_revocation_guard() returns trigger
language plpgsql as $$
begin
  if old.revoked_at is not null and (
       new.revoked_at is distinct from old.revoked_at
    or new.revoke_reason is distinct from old.revoke_reason
    or new.revoked_by is distinct from old.revoked_by) then
    raise exception 'a credential revocation is permanent';
  end if;
  if new.revoked_at is not null and old.revoked_at is null and coalesce(new.revoke_reason, '') = '' then
    raise exception 'a revocation requires a reason';
  end if;
  return new;
end $$;

create trigger credential_link_revocation_guard
  before update on credential_link
  for each row execute function credential_link_revocation_guard();
