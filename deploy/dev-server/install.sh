#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

apt-get update
apt-get install -y ca-certificates curl git nodejs npm openssh-client openssl

if ! id codeg >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/codeg --shell /bin/bash codeg
fi

install -d -o codeg -g codeg -m 0750 /var/lib/codeg /srv/codeg/projects
install -d -m 0755 /etc/codeg /opt/codeg-dev/releases

if [[ ! -f /etc/codeg/codeg.env ]]; then
  token="$(openssl rand -hex 32)"
  printf 'CODEG_TOKEN=%s\n' "$token" > /etc/codeg/codeg.env
  chmod 0600 /etc/codeg/codeg.env
fi

install -m 0755 "$script_dir/update-codeg-dev" /usr/local/sbin/update-codeg-dev
install -m 0644 "$script_dir/codeg.service" /etc/systemd/system/codeg.service
install -m 0644 "$script_dir/codeg-update.service" /etc/systemd/system/codeg-update.service
install -m 0644 "$script_dir/codeg-update.timer" /etc/systemd/system/codeg-update.timer

systemctl daemon-reload
systemctl enable codeg.service codeg-update.timer
systemctl start codeg-update.timer
systemctl start codeg-update.service

echo "Codeg is listening on port 3080."
echo "Read the access token with: sudo sed -n 's/^CODEG_TOKEN=//p' /etc/codeg/codeg.env"
