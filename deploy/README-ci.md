# CI workflow (parked)

`github-ci.yml` is the GitHub Actions workflow for this repo: Node 22, `npm ci`,
Chromium, `next build`, `npm test` (spec tests 1-13, axe in both themes), and
the grep gate (`npm run test:grep`).

The BIGTRG GitHub App that pushes code lacks the `workflows` permission, so it
cannot create `.github/workflows/ci.yml` itself (GitHub rejects the push). To
activate CI, a human with write access does once:

    mkdir -p .github/workflows
    git mv deploy/github-ci.yml .github/workflows/ci.yml
    git commit -m "Enable CI" && git push

No secrets are needed: the suite runs against embedded Postgres, a fake Redis
and a scripted Learning Core.
