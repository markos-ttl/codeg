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

The timer checks the rolling release once per hour. Run an update immediately
with:

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
hours. The sync uses a repository-scoped write deploy key and a normal
fast-forward push. It refuses to overwrite a diverged fork `main`.

After registering the printed public key on `markos-ttl/codeg`, start the first
sync and inspect it with:

```bash
sudo systemctl start codeg-upstream-sync.service
systemctl status codeg-upstream-sync.service
systemctl list-timers codeg-upstream-sync.timer
```
