# Personal dev server deployment

This installs the rolling `dev-latest` Linux x64 bundle as a headless systemd
service. It does not install the Codeg desktop application.

The service runs as the unprivileged `codeg` user with these paths:

- projects: `/srv/codeg/projects`
- persistent database and agent state: `/var/lib/codeg`
- release bundles: `/opt/codeg-dev/releases`
- access token: `/etc/codeg/codeg.env`

Install from a checkout of the `dev` branch:

```bash
sudo ./deploy/dev-server/install.sh
```

Read the generated access token:

```bash
sudo sed -n 's/^CODEG_TOKEN=//p' /etc/codeg/codeg.env
```

Open `http://SERVER-IP:3080` and enter that token. In Codeg, open Settings,
then Agents, and install the Claude Code adapter. Codeg launches
`claude-agent-acp`; a separate desktop GUI is not required on the server.

The timer checks the rolling release checksum once per hour. It downloads the
server archive and restarts Codeg only when that checksum changes. After a
successful update, it removes the temporary archive and older extracted
releases. Run an update check immediately with:

```bash
sudo systemctl start codeg-update.service
```

Useful diagnostics:

```bash
systemctl status codeg.service
journalctl -u codeg.service -n 100 --no-pager
systemctl list-timers codeg-update.timer
```

Port 3080 is plain HTTP. Keep it on a trusted LAN or put it behind a VPN or a
TLS reverse proxy before exposing it to the public internet.

## Upstream fork sync

`install-upstream-sync.sh` configures one host to check upstream every six
hours. Each successful run:

1. Fast-forwards `markos-ttl/codeg:main` from `xintaofei/codeg:main`.
2. Merges the updated fork `main` into `markos-ttl/codeg:dev`.

Both pushes are normal fast-forward pushes. They refuse to overwrite a
diverged fork `main` or new work pushed to `dev` during the sync. Personal
commits remain on `dev`, and a successful merge triggers the rolling dev
builds. A merge conflict fails the sync job without changing the remote `dev`
branch.

After registering the printed public key on `markos-ttl/codeg`, start the first
sync and inspect it with:

```bash
sudo systemctl start codeg-upstream-sync.service
systemctl status codeg-upstream-sync.service
systemctl list-timers codeg-upstream-sync.timer
```

Rerun `install-upstream-sync.sh` after changing the checked-in sync script so
the copy in `/usr/local/sbin` is updated.
