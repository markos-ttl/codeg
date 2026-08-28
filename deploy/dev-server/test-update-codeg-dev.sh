#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly updater="$script_dir/update-codeg-dev"

if ! grep -q 'CODEG_INSTALL_ROOT' "$updater"; then
  echo "FAIL: updater does not support an isolated install root"
  exit 1
fi

sandbox="$(mktemp -d)"
trap 'rm -rf -- "$sandbox"' EXIT

fixture_dir="$sandbox/fixture"
install_root="$sandbox/install"
mock_bin="$sandbox/bin"
state_dir="$sandbox/state"
tmp_root="$sandbox/tmp"
mkdir -p "$fixture_dir/codeg-server-linux-x64/web" \
  "$install_root/releases" "$mock_bin" "$state_dir" "$tmp_root"

cat > "$mock_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

output=""
url=""
while (($#)); do
  case "$1" in
    --output)
      output="$2"
      shift 2
      ;;
    http*)
      url="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

case "$url" in
  *.sha256)
    cp "$FIXTURE_DIR/archive.sha256" "$output"
    ;;
  *.tar.gz)
    count_file="$STATE_DIR/archive-downloads"
    count=0
    [[ -f "$count_file" ]] && count="$(cat "$count_file")"
    printf '%s\n' "$((count + 1))" > "$count_file"
    cp "$FIXTURE_DIR/archive.tar.gz" "$output"
    ;;
  *)
    echo "Unexpected URL: $url" >&2
    exit 1
    ;;
esac
EOF

cat > "$mock_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$*" != "restart codeg.service" ]]; then
  echo "Unexpected systemctl command: $*" >&2
  exit 1
fi

count_file="$STATE_DIR/restarts"
count=0
[[ -f "$count_file" ]] && count="$(cat "$count_file")"
printf '%s\n' "$((count + 1))" > "$count_file"
EOF

chmod +x "$mock_bin/curl" "$mock_bin/systemctl"

make_fixture() {
  local content="$1"
  printf '%s\n' "$content" > "$fixture_dir/codeg-server-linux-x64/codeg-server"
  printf 'companion\n' > "$fixture_dir/codeg-server-linux-x64/codeg-mcp"
  printf 'web\n' > "$fixture_dir/codeg-server-linux-x64/web/index.html"
  chmod +x "$fixture_dir/codeg-server-linux-x64/codeg-server" \
    "$fixture_dir/codeg-server-linux-x64/codeg-mcp"
  tar -C "$fixture_dir" -czf "$fixture_dir/archive.tar.gz" codeg-server-linux-x64
  fixture_sha="$(sha256sum "$fixture_dir/archive.tar.gz" | cut -d' ' -f1)"
  printf '%s  codeg-server-linux-x64.tar.gz\n' "$fixture_sha" > "$fixture_dir/archive.sha256"
}

run_updater() {
  PATH="$mock_bin:$PATH" \
    FIXTURE_DIR="$fixture_dir" \
    STATE_DIR="$state_dir" \
    TMPDIR="$tmp_root" \
    CODEG_INSTALL_ROOT="$install_root" \
    CODEG_RELEASE_URL="https://example.invalid/dev-latest" \
    "$updater"
}

read_count() {
  local file="$1"
  if [[ -f "$file" ]]; then
    cat "$file"
  else
    printf '0\n'
  fi
}

make_fixture "version one"
mkdir -p "$install_root/releases/$fixture_sha/web"
cp -R "$fixture_dir/codeg-server-linux-x64/." "$install_root/releases/$fixture_sha/"
ln -s "$install_root/releases/$fixture_sha" "$install_root/current"
old_sha="$fixture_sha"

run_updater
[[ "$(read_count "$state_dir/archive-downloads")" == "0" ]]
[[ "$(read_count "$state_dir/restarts")" == "0" ]]

make_fixture "version two"
run_updater
[[ "$(read_count "$state_dir/archive-downloads")" == "1" ]]
[[ "$(read_count "$state_dir/restarts")" == "1" ]]
[[ "$(basename "$(readlink -f "$install_root/current")")" == "$fixture_sha" ]]
[[ -x "$install_root/current/codeg-server" ]]
[[ ! -d "$install_root/releases/$old_sha" ]]
[[ "$(find "$install_root/releases" -mindepth 1 -maxdepth 1 -type d | wc -l)" == "1" ]]
[[ -z "$(find "$tmp_root" -mindepth 1 -print -quit)" ]]

run_updater
[[ "$(read_count "$state_dir/archive-downloads")" == "1" ]]
[[ "$(read_count "$state_dir/restarts")" == "1" ]]

echo "PASS: updater downloads and restarts only when the hash changes"
