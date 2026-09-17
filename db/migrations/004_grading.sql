-- RELI application schema · migration 004 — constructed-response grading record.
--
-- The Core stores the model elements and the final score. The app grades
-- constructed items deterministically (src/lib/grading.mjs) and posts points
-- to the Core. What the app keeps is only WHICH elements matched, as booleans
-- per item, so the result screen can name the missed elements (fetched from
-- the Core at view time) without the app ever storing content or responses.
alter table attempt_link
  add column grading jsonb,
  add column graded_at timestamptz;
