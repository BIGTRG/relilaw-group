-- RELI application database roles.
-- Run as a privileged user AFTER migrations, with:
--   psql -v app_password='<s1>' -v legal_password='<s2>' -v auditor_password='<s3>' -f db/roles.sql
--
-- Three roles, three blast radii:
--   reli_app     — what the application runs as. No superuser, no BYPASSRLS
--                  (the Core's decorative-RLS lesson), and NO INSERT on
--                  publish_signoff: the app role physically cannot sign off
--                  jurisdiction content. There is no force_publish because
--                  there is no privilege to build one on.
--   reli_legal   — used ONLY by the legal-reviewer sign-off code path, after a
--                  verified legal-role session with MFA. Adds exactly one
--                  privilege: INSERT on publish_signoff.
--   reli_auditor — read-only at the role level, not merely in the UI (test 4).

do $$ begin
  if not exists (select from pg_roles where rolname = 'reli_app') then
    create role reli_app login;
  end if;
  if not exists (select from pg_roles where rolname = 'reli_legal') then
    create role reli_legal login;
  end if;
  if not exists (select from pg_roles where rolname = 'reli_auditor') then
    create role reli_auditor login;
  end if;
end $$;

alter role reli_app     password :'app_password'     nosuperuser nobypassrls nocreatedb nocreaterole;
alter role reli_legal   password :'legal_password'   nosuperuser nobypassrls nocreatedb nocreaterole;
alter role reli_auditor password :'auditor_password' nosuperuser nobypassrls nocreatedb nocreaterole;

grant connect on database reli to reli_app, reli_legal, reli_auditor;
grant usage on schema public to reli_app, reli_legal, reli_auditor;

-- Baseline: wipe, then grant deliberately.
revoke all on all tables in schema public from reli_app, reli_legal, reli_auditor;

-- reli_app: normal application access…
grant select, insert, update on
  app_user, password_credential, passkey_credential, totp_secret, recovery_code,
  role_grant, stripe_customer, stripe_event, entitlement, review_item, email_log,
  org, seat, org_group, org_group_member, assignment_rule,
  jurisdiction, law_item, law_citation, change_event,
  product, learner_link, enrollment_link, attempt_link, credential_link,
  content_version
to reli_app;

-- …the pipeline transition log is append-only, like audit_event: INSERT yes,
-- UPDATE/DELETE never, for every role (migration 003 also freezes a published
-- content_version by trigger).
grant select, insert on pipeline_transition to reli_app;
grant delete on passkey_credential, recovery_code, org_group_member to reli_app;

-- …audit_event is append-only: INSERT yes, UPDATE/DELETE never.
grant select, insert on audit_event to reli_app;
grant usage on all sequences in schema public to reli_app;

-- …and publish_signoff is READ-ONLY for the app role. This line is the gate.
grant select on publish_signoff to reli_app;

-- reli_legal: everything reli_app has, plus the one privilege that matters.
grant reli_app to reli_legal;
grant insert on publish_signoff to reli_legal;

-- reli_auditor: read everything, change nothing.
grant select on all tables in schema public to reli_auditor;

-- Guards: fail loudly if the gate is decorative.
do $$
declare bad int;
begin
  -- app role must not be able to write a sign-off
  if has_table_privilege('reli_app', 'publish_signoff', 'insert')
     or has_table_privilege('reli_app', 'publish_signoff', 'update')
     or has_table_privilege('reli_app', 'publish_signoff', 'delete') then
    raise exception 'GATE FAILURE: reli_app can write publish_signoff';
  end if;
  -- audit must be append-only
  if has_table_privilege('reli_app', 'audit_event', 'update')
     or has_table_privilege('reli_app', 'audit_event', 'delete') then
    raise exception 'GATE FAILURE: audit_event is not append-only for reli_app';
  end if;
  -- the pipeline log must be append-only for every application role
  if has_table_privilege('reli_app', 'pipeline_transition', 'update')
     or has_table_privilege('reli_app', 'pipeline_transition', 'delete')
     or has_table_privilege('reli_legal', 'pipeline_transition', 'update')
     or has_table_privilege('reli_legal', 'pipeline_transition', 'delete') then
    raise exception 'GATE FAILURE: pipeline_transition is not append-only';
  end if;
  -- nobody deletes a content version through the app
  if has_table_privilege('reli_app', 'content_version', 'delete') then
    raise exception 'GATE FAILURE: reli_app can delete content_version';
  end if;
  -- auditor must not write anywhere
  select count(*) into bad
  from information_schema.table_privileges
  where grantee = 'reli_auditor' and privilege_type <> 'SELECT';
  if bad > 0 then
    raise exception 'GATE FAILURE: reli_auditor holds % non-SELECT privileges', bad;
  end if;
  -- no superuser / bypassrls anywhere
  if exists (select from pg_roles
             where rolname in ('reli_app','reli_legal','reli_auditor')
               and (rolsuper or rolbypassrls)) then
    raise exception 'GATE FAILURE: privileged attribute on an application role';
  end if;
end $$;
