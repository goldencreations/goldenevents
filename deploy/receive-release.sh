#!/usr/bin/env bash
set -Eeuo pipefail

archive=${1:?Usage: receive-release.sh /tmp/release.tar.gz}
: "${RELEASE_SHA:?RELEASE_SHA is required}"

app_root=/opt/goldenevents
releases_dir="$app_root/releases"
shared_dir="$app_root/shared"
current_link="$app_root/current"
release_dir="$releases_dir/$RELEASE_SHA"

case "$RELEASE_SHA" in
  (*[!0-9a-f]*|'') echo 'RELEASE_SHA must be a lowercase Git commit SHA' >&2; exit 2 ;;
esac

if [[ "$archive" != "/tmp/goldenevents-${RELEASE_SHA}.tar.gz" ]]; then
  echo 'Unexpected release archive path' >&2
  exit 2
fi

mkdir -p "$release_dir"
tar -xzf "$archive" -C "$release_dir"
rm -f "$archive"

exec env RELEASE_SHA="$RELEASE_SHA" bash "$release_dir/deploy/release.sh"
