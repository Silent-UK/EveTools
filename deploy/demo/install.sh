#!/usr/bin/env bash
set -euo pipefail
# Install or finish a staged demo. No live Tools data is installed.
if [ "$(id -u)" -ne 0 ]; then echo 'Run this installer with sudo.' >&2; exit 1; fi
source_dir="$(cd -- "$(dirname -- "$0")/../.." && pwd)"
release_id="$(basename -- "$source_dir")"
[[ "$release_id" =~ ^[a-f0-9]{40}$ ]] || { echo 'Use a prepared Git release directory.'; exit 1; }
public_catalog="${1:?Provide the CCP catalog.sqlite path (never tools.sqlite)}"
[[ "$(basename -- "$public_catalog")" == 'catalog.sqlite' ]] || exit 1
[ -f "$source_dir/node_modules/express/package.json" ] || { echo 'Install dependencies in the staged release first.'; exit 1; }
if [ -e /etc/nginx/sites-enabled/evetools-demo ] && [ "$(readlink /etc/nginx/sites-enabled/evetools-demo)" != '/etc/nginx/sites-available/evetools-demo' ]; then echo 'Unexpected demo site configuration; review manually.'; exit 1; fi
if ss -ltn | grep -q ':3020 ' && ! systemctl is-active --quiet evetools-demo; then echo 'Port 3020 is already in use.'; exit 1; fi
install -d -m 755 /opt/evetools-demo/releases /opt/evetools-demo/catalog
install -m 644 "$public_catalog" /opt/evetools-demo/catalog/catalog.sqlite
mkdir -p "/opt/evetools-demo/releases/$release_id"
cp -a -- "$source_dir/." "/opt/evetools-demo/releases/$release_id/"
chown -R root:root "/opt/evetools-demo/releases/$release_id"
chmod -R a+rX "/opt/evetools-demo/releases/$release_id"
ln -sfnT "/opt/evetools-demo/releases/$release_id" /opt/evetools-demo/current
install -m 644 "$source_dir/deploy/demo/evetools-demo.service" /etc/systemd/system/evetools-demo.service
systemctl daemon-reload
systemctl enable evetools-demo
systemctl restart evetools-demo
ready=0
for attempt in $(seq 1 30); do
 if curl --fail --silent http://127.0.0.1:3020/health; then ready=1; break; fi
 sleep 1
done
if [ "$ready" -ne 1 ]; then systemctl status evetools-demo --no-pager; journalctl -u evetools-demo -n 30 --no-pager; exit 1; fi
# Preserve any HTTPS configuration already created by Certbot on a previous run.
if [ ! -e /etc/nginx/sites-available/evetools-demo ]; then install -m 644 "$source_dir/deploy/demo/evetools-demo.conf" /etc/nginx/sites-available/evetools-demo; fi
if [ ! -e /etc/nginx/sites-enabled/evetools-demo ]; then ln -s /etc/nginx/sites-available/evetools-demo /etc/nginx/sites-enabled/evetools-demo; fi
if ! nginx -t; then rm /etc/nginx/sites-enabled/evetools-demo; exit 1; fi
systemctl reload nginx
if ! getent ahostsv4 demo.areyouaspy.co.uk >/dev/null; then
 echo 'Site is prepared. When DNS resolves, run: sudo certbot --nginx -d demo.areyouaspy.co.uk --redirect'
 exit 0
fi
certbot --nginx -d demo.areyouaspy.co.uk --redirect --non-interactive --agree-tos
curl --fail --silent https://demo.areyouaspy.co.uk/health
printf '\nDemo installed. Production STEMP and NARVI were not changed.\n'
