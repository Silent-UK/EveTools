# Install EveTools v1.0.0

These instructions use Debian/Ubuntu-style packages, systemd and Nginx. Replace `tools.example.com` with your domain. EveTools is a single-corporation installation: give another corporation a separate database, encryption key and hosting configuration.

## 1. Host requirements

- A Linux host with Node.js **24 or newer**, npm, Python 3, Git, curl, Nginx, Certbot and the Python Nginx Certbot plugin.
- A domain whose DNS points to the host, with inbound HTTP/HTTPS available. Keep application port 3014 on loopback.
- Egress to EVE SSO, ESI, CCP static data, GitHub and npm; Discord and linked public sources when used.
- Enough disk space for CCP static data/catalogue, private snapshots, backups, dependencies and releases. Usage depends on connected pilots and scope of data; no public-hosting capacity benchmark is claimed.

Install Node from your chosen official/distribution-supported source. The service template expects `/usr/bin/node`; change ExecStart if your supported system-wide installation is elsewhere. Do not use a user-shell-only version manager for this service.

```sh
node --version # must be v24 or newer
npm --version
python3 --version
sudo apt update
sudo apt install git curl python3 nginx certbot python3-certbot-nginx sqlite3
sudo useradd --system --create-home --home-dir /opt/evetools --shell /usr/sbin/nologin evetools
sudo install -d -o evetools -g evetools -m 750 /opt/evetools /opt/evetools/releases
sudo install -d -o evetools -g evetools -m 700 /var/lib/evetools
sudo install -d -o root -g evetools -m 750 /etc/evetools
sudo -u evetools git clone https://github.com/Silent-UK/EveTools.git /opt/evetools/repo
```

## 2. Register your EVE developer application

Create your own application at [EVE Developers](https://developers.eveonline.com/). Use authentication access and set the callback to exactly:

```text
https://tools.example.com/auth/callback
```

Select the scopes used by the current release. Print them from the checked-out source rather than maintaining an outdated copied list:

```sh
cd /opt/evetools/repo
node --input-type=module -e "import {SCOPES} from './lib/eve.mjs'; console.log(SCOPES.join('\n'))"
```

Normal login includes personal and corporation scopes. Roles and server permission checks still govern their use. Projects has a separate optional connection and `esi-corporations.read_projects.v1`; enable it too if you will use Corporation Projects. Adding scopes later requires affected pilots to reconnect. The PI scope has `manage_planets` in its name; EveTools reads planetary data. Save your Client ID and Client Secret privately.

## 3. Configure your installation

```sh
sudo install -o root -g evetools -m 640 /opt/evetools/repo/.env.example /etc/evetools/evetools.env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
sudo nano /etc/evetools/evetools.env
```

Copy that generated encryption key into `ENCRYPTION_KEY`. Configure:

| Variable | Value |
| --- | --- |
| BASE_URL | Your public HTTPS origin, without a trailing path, e.g. `https://tools.example.com` |
| PORT | `3014` for the supplied service/proxy templates |
| DATA_DIR | `/var/lib/evetools` |
| EVE_CLIENT_ID / EVE_CLIENT_SECRET | Your own EVE developer app credentials |
| ENCRYPTION_KEY | 64 hexadecimal characters, generated once and backed up |
| OWNER_CHARACTER_ID | The numeric EVE character ID of the installation owner, not a corporation/account ID |
| CORPORATION_ID | Your numeric EVE corporation ID |
| CORPORATION_NAME / CORPORATION_TICKER | Your corporation's name and ticker |
| SITE_NAME | Your displayed name; defaults to `EveTools` |
| ALLIANCE_TICKER | Optional; leave empty if unused |
| ESI_CONTACT | Your support email or public project/contact URL for API identification |

You can find numeric character/corporation IDs through EVE public sources such as a zKillboard entity link or ESI. Verify the owner ID carefully: that character receives installation-owner access. Startup validates required values and rejects missing/invalid owner IDs, corporation IDs or encryption keys. Never place real credentials in `.env.example`, Git, an issue or a screenshot. Do not regenerate the key for an existing database.

## 4. Import CCP static data

The catalogue powers type names, skills and other lookups. Download CCP's JSONL SDE ZIP and import it before first startup:

```sh
sudo -u evetools curl --fail --location https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip -o /var/lib/evetools/sde.zip
sudo -u evetools python3 /opt/evetools/repo/scripts/import-sde.py /var/lib/evetools/sde.zip /var/lib/evetools
```

The importer reports the type count and writes `catalog.sqlite`. The application ships its fitting engine/runtime and recipes; do not rebuild or remove those just to install. Moon surveys start empty; upload your own through Moon Surveys → Paste Scan Results. Public moon coordinates and IDs are lookup data, not corporation survey results.

## 5. Install and start the service

```sh
cd /opt/evetools/repo
sudo install -m 644 deploy/evetools.service deploy/evetools-deploy.service deploy/evetools-deploy.timer /etc/systemd/system/
sudo install -m 755 deploy/update.sh /usr/local/bin/evetools-deploy
sudo systemctl daemon-reload
sudo /usr/local/bin/evetools-deploy
sudo systemctl enable evetools.service
curl --fail http://127.0.0.1:3014/health
```

The deployer fetches `main`, creates a separate release, installs dependencies, runs syntax checks and tests, switches the current symlink and starts/restarts EveTools. It leaves the previous application release in place if validation fails and rolls back files if startup health fails. It never imports somebody else's production database.

The template uses `/usr/bin/node`. `DATA_DIR`, the service ReadWritePaths, deployment data symlink and port must agree if you customise paths. To use a different port, change the environment, Nginx proxy and deployer's health URL together. On a fresh installation the health response should report `1.0.0` for this release; it does not prove ESI/Discord connectivity.

## 6. Nginx and HTTPS

Point your domain's A/AAAA records at this server; remove incorrect records. Edit `server_name` in the template before enabling it:

```sh
sudo install -m 644 /opt/evetools/repo/deploy/nginx.conf /etc/nginx/sites-available/evetools
sudo nano /etc/nginx/sites-available/evetools
sudo ln -s /etc/nginx/sites-available/evetools /etc/nginx/sites-enabled/evetools
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d tools.example.com
curl --fail https://tools.example.com/health
```

Only test production sign-in after HTTPS works. Keep the EVE callback and BASE_URL identical in origin. The proxy template avoids logging OAuth callback query strings and supports group-image uploads. Restrict SSH normally; do not expose port 3014 publicly. Follow your hosting provider's firewall instructions for HTTP/HTTPS/administration.

## 7. First login and setup

1. Sign in with the configured owner character. Owner access does not grant permission to read corporation ESI data without the required in-game role/scopes.
2. Open **Admin → Installation Setup**, save identity, and review the readiness checklist. Identity defaults are saved in the database at first startup; editing environment identity fields later does not overwrite saved settings. The configured owner remains in the environment.
3. Connect corporation access with an eligible CEO/director and wait for initial sync. Scope changes require reconnecting. Projects may need its separate connection. See **Admin → Corp ESI** and **ESI Status** for diagnostics.
4. Check **Admin → Whitelist**. A fresh installation allows its own configured corporation only. Add other corporations, alliances or pilots deliberately.
5. Create/configure groups and permissions. Starter groups do not automatically grant privileged pages. Configure recruitment before sharing its application link.
6. Enable optional plugins under **Admin → Plugins**. Configure SRP reviewers, Buyback, Logistics routes/rates and the approval-based Logistics group, and Timerboard visibility as needed.
7. For Discord, create your own bot/app and follow [Discord setup](../docs/DISCORD.md). The callback is `https://tools.example.com/auth/discord/callback`. Role management can remain off; configure channels under Notifications/Timerboard. Server Members Intent is needed for pilot scans.
8. Link an alt, allow sync to finish, and compare representative skills, fuel/timers and access against EVE. An absent scope or unavailable API should be labelled rather than assumed to be zero.

Once live corporation connections or snapshots exist, corporation identity is locked. Use another installation for another corporation. Your owner and private database are not shared with the developer or other installations.

## 8. Updates, backups and recovery

Updates are **manual by default**:

```sh
# Back up first, then deliberately deploy the latest main branch.
sudo /usr/local/bin/evetools-deploy
curl --fail https://tools.example.com/health
sudo systemctl status evetools --no-pager
sudo journalctl -u evetools -n 80 --no-pager
```

Read [release notes](../docs/PATCH_NOTES.md) before updating. The optional timer tracks `main` and will auto-deploy later commits if you explicitly enable it with `sudo systemctl enable --now evetools-deploy.timer`. Leave it disabled to review updates yourself. Stop that timer during recovery.

Back up the private database with SQLite's backup facility for a consistent live backup, or stop the application before copying its database and associated WAL files. Keep backups outside release folders with restricted permissions:

```sh
sudo install -d -o root -g root -m 700 /var/backups/evetools
sudo sqlite3 /var/lib/evetools/tools.sqlite ".backup '/var/backups/evetools/tools.sqlite'"
sudo chmod 600 /var/backups/evetools/tools.sqlite
```

Also back up `/etc/evetools/evetools.env` securely and separately: losing the encryption key makes stored EVE/Discord tokens unreadable. Do not print or upload it. Retain timestamped backups according to your policy. Uploaded group images and member records are in the database; the catalogue can be reproduced from CCP SDE.

Application rollback is not database rollback. Review schema compatibility before pointing `current` at an old release. Restore a database only from a deliberate verified backup, with the service stopped and its original encryption key available. To update SDE, import into a staging data directory, validate it, stop the service and replace the catalogue while retaining the old copy, then restart. Never run the fictional preview process on the VPS.

## Optional corporation contact standings (1.0.2)

To populate corporation/alliance contact standings, enable `esi-corporations.read_contacts.v1` on your EVE developer application, then use Reconnect Corporation ESI on Corporation Standings. This is an explicit optional corporation reconnect; normal sign-ins keep the existing scope set. Existing contacts grants are preserved on later corporation reconnects. NPC standings stay available without the new scope. Back up the database and original encryption key before applying an update; removal archives and typed audit tables migrate automatically.
