# EveTools maintenance and contributions

## Validate changes

Use Node.js 24 or newer and Python 3. Install dependencies with `npm ci`; import a CCP JSONL catalogue as described in the setup guide. Run `npm run check` and `npm test`. Tests use fictional local HTTP servers and temporary databases. Test results do not establish live EVE or Discord connectivity. Optional moon merge checks use `python3 scripts/test-merge-moon-surveys.py`.

Keep layouts compact and theme-aware. Check server-side access, inspection/recruitment restrictions, snapshot retention during transient failures and the mobile layout for affected views. Do not expose private responses or credentials in logs. Place regressions in the relevant test module.

## Public releases

Align the version in package.json, package-lock.json, public/app.js and server.mjs; add release notes. Rebuild `lib/fitting-source.zip` after final edits. Inspect the archive and Git diff for secrets/private data, preserve licences, then commit, push and tag the release when authorised. Never copy a live data directory or the private Git history of an installation into this public repository. The bundled moon catalogue must stay empty; importers work with operator-provided data.

## Installation updates

Operators should review release notes and back up the database plus encryption key before updating. The supplied `deploy/update.sh` validates a separate release before switching the current symlink and restarting the service; it rolls back application files if startup health fails. It does not reverse database migrations. Use `sudo /usr/local/bin/evetools-deploy` for a deliberate update. The optional timer is disabled unless an operator explicitly enables it.

Keep .env and database backups outside releases and out of Git. Never replace an existing encryption key to troubleshoot a login failure. Preserve saved ESI snapshots on API outages. See deploy/SETUP.md for backup and recovery steps.

## Optional data tooling

The in-app moon clipboard importer needs no extra Python packages. The advanced legacy workbook converter `scripts/import-moon-surveys.py` requires `openpyxl` in an isolated Python environment and its expected workbook schema; it is not required for normal installation. The merge utility supports preview before deliberate writes. CCP static-data and fitting rebuild scripts are documented in their source and the fitting guide; do not replace runtime datasets with incomplete imports.
