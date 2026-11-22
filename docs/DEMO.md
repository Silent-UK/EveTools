# Public interactive demo

The `codex/public-demo` branch is a separate EveTools 1.0.0 demonstration. It is not the upcoming 1.0.1 release and must never be deployed over a production installation.

Visitors enter as the fictional Aurora Vanguard installation owner, with access to pilot pages, corporation pages and admin features. No EVE SSO is required. The sample workspace includes pilots and alts, skills, PI, industry, assets, wallets, fittings, structures and fuel, moon extraction, calendar events, timers and targets, recruitment, groups, courier and buyback requests, announcements, audit history and Discord setup examples.

## Isolation

Each visitor receives a separate SQLite database in memory, random internal session credentials and a host-only, HttpOnly session cookie. Changes are private to that visitor. Idle workspaces expire after 30 minutes (45 minutes maximum lifetime); Reset demo restores the fictional fixtures. Workspaces are lost when the service restarts. At most 24 visitors are active at once; request and session-creation limits bound resource use.

No production environment file, database, pilot identities, corporation intelligence, Discord credentials or tokens are loaded. The catalogue is CCP public static item/skill data only. Live syncs and external connection actions display a demo-only explanation. The standalone demo process disables outbound fetch, and the systemd unit additionally denies outbound socket connections. Production background workers never start. Sample character portraits are local illustrations; item icons use CCP's public image service.

Do not enter real credentials or personal information. The demo banner remains visible while exploring admin pages. Admin settings affect only the visitor's temporary workspace. Discord connection settings are examples and cannot connect to a real server. This branch uses the public 1.0.0 feature set; it does not claim to preview every unreleased STEMP/NARVI change.

## Run locally

Use Node 24 or newer. Install dependencies with `npm ci`. Place a CCP catalogue at `data/catalog.sqlite` using the normal catalogue importer (see README). Do not copy an installation's data directory.

PowerShell:

```powershell
$env:DEMO_BASE_URL='http://127.0.0.1:3020'
$env:DEMO_PORT='3020'
$env:DEMO_CATALOG_DIR='C:/path/to/public-catalog-directory'
node lib/demo-server.mjs
```

Linux:

```sh
DEMO_BASE_URL=http://127.0.0.1:3020 DEMO_CATALOG_DIR=/path/to/public-catalog node lib/demo-server.mjs
```

The service listens only on loopback. Do not run `npm start` for a public demo; that starts the normal production application.

## Verify

Run `npm run check` and `npm test`. To include the integration checks with a complete public catalogue, set `DEMO_TEST_CATALOG` to its directory before running `node --test tests/demo.test.mjs`. Those checks cover admin access, pilot/corporation APIs, visitor separation, private edits, CSRF protection, reset, disabled live sync and no-SSO navigation. They do not test live EVE or Discord delivery.

## Install on the demo host

1. Point the A record for `demo.areyouaspy.co.uk` to the chosen host. Only add an AAAA record if IPv6 reaches the same host.
2. Stage a Git archive of this branch in a directory named with its full 40-character commit SHA. Run `npm ci --omit=dev --ignore-scripts` there as an unprivileged user.
3. Run the prepared installer as root, supplying only the public CCP catalogue file:

```sh
sudo bash /path/to/COMMIT/deploy/demo/install.sh /path/to/catalog.sqlite
```

The host needs Node 24+, Nginx, systemd, Certbot and its Nginx plugin. The installer creates `/opt/evetools-demo`, a distinct `evetools-demo` service and an exact-name Nginx site on loopback port 3020, then requests HTTPS. It refuses an occupied port or an already installed demo. It never changes STEMP/NARVI application services or their data. Review DNS before running; HTTPS issuance needs public DNS and ports 80/443. If certificate issuance fails, the demo remains on HTTP and secure cookies will not work until HTTPS is configured. Review `journalctl -u evetools-demo` and the installer output before retrying the certificate step.

For future demo updates, stage and verify another isolated release, switch only `/opt/evetools-demo/current`, then restart only `evetools-demo`. Restart resets all visitor workspaces. Keep production releases and the public main branch unchanged.

The AGPL corresponding-source download remains available in the application. Regenerate it after final edits using `node scripts/build-fitting-source.mjs`.
