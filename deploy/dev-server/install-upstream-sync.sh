#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly key_dir="/etc/codeg-upstream-sync"

install -d -m 0700 "$key_dir"
if [[ ! -f "$key_dir/id_ed25519" ]]; then
  ssh-keygen -q -t ed25519 -N '' -C 'fuji-codeg-upstream-sync' \
    -f "$key_dir/id_ed25519"
fi

install -m 0755 "$script_dir/sync-codeg-upstream-main" \
  /usr/local/sbin/sync-codeg-upstream-main
install -m 0644 "$script_dir/codeg-upstream-sync.service" \
  /etc/systemd/system/codeg-upstream-sync.service
install -m 0644 "$script_dir/codeg-upstream-sync.timer" \
  /etc/systemd/system/codeg-upstream-sync.timer

systemctl daemon-reload
systemctl enable --now codeg-upstream-sync.timer

echo "Register this deploy key with write access to markos-ttl/codeg:"
cat "$key_dir/id_ed25519.pub"
