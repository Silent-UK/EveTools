# EveTools

**Your pilots. Your corporation. One command centre.**

EveTools is a self-hosted EVE Online management platform for pilots and corporations. Connect characters through EVE SSO, bring your corporation's ESI data together, and manage everyday activity, access, logistics and alerts in a compact, theme-aware workspace.

**Version 1.0.0 · Node.js 24+ · SQLite · AGPL-3.0-only**

## What can it do?

| Area | Highlights |
| --- | --- |
| Pilot management | Linked mains and alts, character overview, skills and training queues, subscriptions/MCT, clones, wallets, contracts, standings and assets |
| Industry and fittings | Manufacturing/reaction/science slot availability, jobs and blueprints, skill plans, fitting imports, pilot readiness and fitting calculations |
| Corporation management | Profiles, joiners/leavers, members and roles, wallets, contracts, projects, assets, industry, structures and expandable fittings |
| Structures and resources | Fuel/gas monitoring and shopping lists, moon mining, scan imports, production/value estimates, reinforcement and anchoring timers |
| Dashboard and operations | Announcements, Needs your action, attack/reinforcement alerts, PI and contract notices, Timerboard targets, searchable timers and recurring calendar events |
| Discord plugin | Account linking, pilot name matching with approval, optional group-role sync, configurable alerts, daily fuel summaries and an updating timerboard |
| SRP and Buyback plugins | Claim review, approval amounts and rejection reasons, account-wide payout requests, buyback quotes, payments and contract settlement |
| Logistics plugin | Approved hauler group, directional isotope-only pricing, cargo limits, ESI courier queue and exclusive hauler claim/completion tracking |
| Community and administration | Approval/rule-based groups, recruitment and inspection tools, page permissions, announcements, configurable identity and an audit log |

Pages support compact layouts and mobile use. Features can be enabled as needed; access is controlled on the server. Saved snapshots remain available during temporary API failures, with their status shown.

## Install and set up

Follow the **[installation guide](deploy/SETUP.md)** for a complete Linux installation: Node/Python requirements, EVE developer application, scopes, static data, environment configuration, systemd, Nginx, HTTPS, first login and backups.

You need a Linux host, a domain with HTTPS, an EVE developer application and the EVE character ID of your installation owner. Corporation features need an appropriately authorised CEO/director and the relevant ESI scopes. Use a separate installation/database for each corporation.

```sh
git clone https://github.com/Silent-UK/EveTools.git
cd EveTools
npm ci
cp .env.example .env
# Edit .env with YOUR owner/corporation IDs, EVE app and encryption key.
# Download/import CCP static data as described in deploy/SETUP.md.
npm run check
npm test
npm start
```

Production binds to `127.0.0.1`; put the supplied Nginx template and HTTPS in front of it. Startup rejects missing owner/corporation details and invalid configuration. Never commit `.env` or regenerate the encryption key for an existing database.

After sign-in, use **Admin → Installation Setup** to complete identity and readiness checks, connect corporation access, configure the whitelist, enable plugins and set up groups. Only the configured owner can save installation identity.

### Try the interface locally

After importing a catalogue into `data/`, run `node scripts/preview.mjs` and open `http://127.0.0.1:3014`. It uses a temporary database with fictional data and bypasses SSO **only in that preview process**. Never run the preview on a public server. `PREVIEW_LOGISTICS=1` adds fictional courier examples. Stop it before starting the real service on the same port.

## Guides

- [Installation and hosting](deploy/SETUP.md)
- [Installation Setup, Dashboard, announcements and audit](docs/INSTALLATION_AND_DASHBOARD.md)
- [Discord configuration](docs/DISCORD.md)
- [Logistics routes, group access and couriers](docs/LOGISTICS.md)
- [Recruitment](docs/RECRUITMENT.md) · [custom pages](docs/PAGES.md)
- [Fitting engine and corresponding source](docs/FITTING_WORKSPACE_REVIEW.md)
- [Asset safety](docs/ASSET_SAFETY.md) · [ESI diagnostics](docs/ESI_DIAGNOSTICS.md)
- [Maintenance and contributing](docs/MAINTENANCE.md) · [v1.0.0 release notes](docs/PATCH_NOTES.md)

## Data and API expectations

This release includes application code, recipes, fitting runtime and public universe lookup data. It includes **no production accounts, credentials, tokens, databases or corporation moon-survey intelligence**. The survey catalogue starts empty; paste/import your own moon scans. Your private uploads and ESI snapshots stay in your installation's data directory.

Displayed information depends on granted scopes, character permissions, ESI availability and cache times. Fuel, fitting and production values are estimates where labelled. Corp fitting import supports in-game XML exports with selection before saving. EveTools records SRP/Buyback payments and delivery workflow; send ISK, accept/deliver contracts and perform other in-game actions in EVE.

## Development

`server.mjs` hosts the application; `lib/` contains services; `public/` contains the browser UI; `tests/` contains local automated checks; `scripts/` contains import/build tools; `deploy/` contains generic hosting templates. Run `npm run check`, `npm test` and, for the optional moon merge utility, `python3 scripts/test-merge-moon-surveys.py`.

## Licence and attribution

EveTools is released under **[AGPL-3.0-only](LICENSE)** and incorporates the VYRAJ fitting engine. Preserve [its notices](vendor/vyraj/NOTICE.md). Signed-in users can download corresponding application source from Fitting Workbench. Rebuild that archive after changes with `node scripts/build-fitting-source.mjs`; `npm test` also rebuilds it.

EVE Online and CCP assets belong to CCP Games. EveTools is not affiliated with or endorsed by CCP. See [CCP's developer resources](https://developers.eveonline.com/) for ESI, SSO and static data.

Originally developed as STEMP Tools. Public releases use their own version history; existing corporation installations are independent.
