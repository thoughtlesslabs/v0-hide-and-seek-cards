#!/bin/sh
set -eu

if [ "${CONFIGURATION:-}" != "Release" ]; then
  exit 0
fi

fail() {
  echo "error: Native release validation failed: $*" >&2
  exit 1
}

manifest="${SRCROOT}/App/public/native-release.plist"
assets_dir="${SRCROOT}/App/public/assets"

[ -f "$manifest" ] || fail "missing $manifest. Run the native release sync with a public HTTPS server origin before archiving."
/usr/bin/plutil -lint "$manifest" >/dev/null 2>&1 || fail "invalid property list in $manifest"

schema_version="$(/usr/bin/plutil -extract schemaVersion raw -expect integer -o - "$manifest" 2>/dev/null)" || fail "schemaVersion is missing or is not an integer"
[ "$schema_version" = "1" ] || fail "schemaVersion must be 1 (found: $schema_version)"

mode="$(/usr/bin/plutil -extract mode raw -expect string -o - "$manifest" 2>/dev/null)" || fail "mode is missing or is not a string"
[ "$mode" = "native-release" ] || fail "mode must be native-release (found: $mode)"

server_origin="$(/usr/bin/plutil -extract serverOrigin raw -expect string -o - "$manifest" 2>/dev/null)" || fail "serverOrigin is missing or is not a string"
[ -n "$server_origin" ] || fail "serverOrigin must not be empty"
printf '%s\n' "$server_origin" | /usr/bin/grep -Eq '^https://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' || fail "serverOrigin must be a public HTTPS origin on the default port without credentials, path, query, or fragment (found: $server_origin)"

[ -d "$assets_dir" ] || fail "missing JavaScript assets directory: $assets_dir"
origin_found=0
for asset in "$assets_dir"/*.js; do
  [ -f "$asset" ] || continue
  if /usr/bin/grep -Fq -- "$server_origin" "$asset"; then
    origin_found=1
    break
  fi
done
[ "$origin_found" -eq 1 ] || fail "serverOrigin $server_origin is not embedded in any public/assets/*.js bundle"

echo "Verified native Release server origin: $server_origin"
