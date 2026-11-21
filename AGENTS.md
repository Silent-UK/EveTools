# EveTools contributor instructions

Read README.md and docs/MAINTENANCE.md before editing or releasing.

- This is the public Silent-UK/EveTools repository. STEMP and NARVI are separate installations; do not deploy to them from here.
- Preserve unrelated work. Keep credentials, .env, databases, data/, production logs, uploaded images and corporation intelligence out of Git and source archives. Use fictional test fixtures. Ship the moon survey catalogue empty.
- Keep default branding and deployment templates generic. Require each operator's own installation owner and corporation. Never add developer accounts or alliance memberships to a fresh whitelist.
- Use compact, theme-aware, responsive layouts; preserve keyboard access and server-side permission checks. Read-only inspection and recruitment boundaries remain authoritative.
- Keep package.json, package-lock.json, sidebar and /health versions aligned for releases. Update release notes and documentation, run npm run check and npm test, then rebuild lib/fitting-source.zip after the final code/docs/package edits.
- Preserve LICENSE and vendor/vyraj/NOTICE.md and the accessible corresponding-source offer. Never include private data in that archive.
- Push public releases only when authorised. Installation deployment is performed by that installation's operator; never assume a Git push should deploy STEMP or NARVI.
