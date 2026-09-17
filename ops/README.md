# Operations

Server-side runbooks for the RELI application (server #2, 178.105.183.91) and
the Learning Core it consumes (server #3, 167.233.117.23). Everything here is
installed on the servers as described; this directory is the source of truth.

## Nightly database backups

| System | Unit | Schedule (UTC) | Database | Target directory | Retention |
|---|---|---|---|---|---|
| RELI app | `relilaw-pg-backup.timer` | 01:45 (+0-10 min jitter) | `reli` on PG 14 :5432 | `/var/backups/relilaw` | 14 days |
| Learning Core | `learning-core-pg-backup.timer` | 01:30 (+0-10 min jitter) | `learning_core` on PG 16 cluster `lc` :5433 | `/var/backups/learning-core` | 14 days |
| Learning Core host | `learning-core-borg.timer` | 03:30 | Borg archive of /etc, /opt/learning-core, /etc/learning-core, both dump dirs to the Hetzner Storage Box repo `ge-api-engine` | 7 daily / 4 weekly / 3 monthly |

All dumps run as the `postgres` OS user over the unix socket, `pg_dump --format=custom --compress=6`,
written 0600 into a 0700 directory, verified with `pg_restore --list` before the
previous `.partial` file is renamed into place. `backup/pg-backup.sh` picks the
right major-version binaries by port (`pg_lsclusters`) because Debian's
`pg_wrapper` otherwise chooses the default cluster's version.

Install (already done on both servers; repeat after a rebuild):

```
# server 2
sudo install -m 755 ops/backup/pg-backup.sh /usr/local/lib/relilaw/pg-backup.sh
sudo install -m 644 ops/backup/relilaw-pg-backup.{service,timer} /etc/systemd/system/
sudo install -d -o postgres -g postgres -m 700 /var/backups/relilaw
sudo systemctl daemon-reload && sudo systemctl enable --now relilaw-pg-backup.timer

# server 3 (as root)
install -m 755 ops/backup/pg-backup.sh /usr/local/lib/learning-core/pg-backup.sh
install -m 644 ops/backup/learning-core-pg-backup.{service,timer} ops/backup/learning-core-borg.{service,timer} /etc/systemd/system/
install -d -o postgres -g postgres -m 700 /var/backups/learning-core
systemctl daemon-reload && systemctl enable --now learning-core-pg-backup.timer learning-core-borg.timer
```

Check: `systemctl list-timers | grep -E 'relilaw|learning-core'` and
`journalctl -u relilaw-pg-backup.service -n 3`.

## Restore drill

`restore-drill.sh` restores the newest dump into `<db>_restore_check`, compares
row counts of the named tables (or every public table if none are named)
against the live database, prints a table, and drops the scratch database.
Exit code is 0 only when every count matches.

```
# server 2, as postgres
sudo -u postgres /opt/relilaw/ops/restore-drill.sh reli /var/backups/relilaw 5432 \
    app_user entitlement content_version review_item credential_link

# server 3, as postgres (every table)
sudo -u postgres /opt/learning-core/ops/restore-drill.sh learning_core /var/backups/learning-core 5433
```

Run the drill after every schema migration and at least monthly. Record the
output in the launch checklist (docs/LAUNCH_CHECKLIST.md) when it is part of a
release.

### Drill output, 2026-09-17 (first run, both PASS)

```
== restore drill: db=reli port=5432
== dump: /var/backups/relilaw/reli_2026-09-17T064917Z.dump (73331 bytes, 2026-09-17T06:49:18Z)
== restored into reli_restore_check in 0s
table                                  live       restored  result
app_user                                  4              4  match
entitlement                               4              4  match
content_version                           1              1  match
review_item                               8              8  match
credential_link                           2              2  match
== public tables: live=30 restored=30
== scratch database reli_restore_check dropped
== RESULT: PASS (all counts match)

== restore drill: db=learning_core port=5433
== dump: /var/backups/learning-core/learning_core_2026-09-17T065009Z.dump (3576596 bytes, 2026-09-17T06:50:10Z)
== restored into learning_core_restore_check in 2s
23 tables compared (api_key 80, approval 8, ... credential 26, learner 142, usage_event 1121524): all match
== public tables: live=23 restored=23
== scratch database learning_core_restore_check dropped
== RESULT: PASS (all counts match)
```

## Full restore (disaster)

1. Recreate roles: `psql -v app_password=... -v legal_password=... -v auditor_password=... -f db/roles.sql` (server 2) or `db/roles.sql` of the Core (server 3).
2. `createdb reli && pg_restore --host=/var/run/postgresql --dbname=reli --no-owner --no-privileges <dump>`.
3. Re-grant: run the GRANT section of `db/roles.sql` (dumps are taken with `--no-privileges` so that a restore into a scratch database never needs the production roles to exist).
4. `pm2 restart relilaw --update-env` and run the restore drill against the new database.

## Deploy (server 2)

```
tar --exclude node_modules --exclude .next -czf /tmp/relilaw.tgz .   # from the repo
scp /tmp/relilaw.tgz viktor@178.105.183.91:/tmp/
ssh viktor@178.105.183.91 'cd /opt/relilaw && sudo tar xzf /tmp/relilaw.tgz && sudo npm ci --omit=dev \
  && sudo -n bash -c "set -a; . /etc/relilaw/env; set +a; DATABASE_URL_ADMIN=postgres:///reli?host=/var/run/postgresql node db/migrate.mjs" \
  && sudo npx next build && sudo cp -r .next/static .next/standalone/.next/ && sudo cp -r brand .next/standalone/ \
  && sudo pm2 restart relilaw --update-env && sudo pm2 save'
```

`brand/` and `.next/static` must both be copied into `.next/standalone/` (the
standalone server does not include them). Staging Redis is 6.0.16 (no GETDEL;
polyfilled in `infra/redis.mjs`).
