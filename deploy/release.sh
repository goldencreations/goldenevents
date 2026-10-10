#!/usr/bin/env bash
set -Eeuo pipefail

: "${RELEASE_SHA:?RELEASE_SHA is required}"

app_root=/opt/goldenevents
releases_dir="$app_root/releases"
shared_dir="$app_root/shared"
current_link="$app_root/current"
release_dir="$releases_dir/$RELEASE_SHA"
project_name=goldenevents
image_tag="$RELEASE_SHA"

if [[ ! -f "$release_dir/compose.yaml" || ! -f "$shared_dir/.env.production" ]]; then
  echo 'Release files or shared production environment are missing' >&2
  exit 1
fi

previous_release=$(readlink -f "$current_link" 2>/dev/null || true)
previous_image_tag=''
if [[ -n "$previous_release" && -f "$previous_release/.image-tag" ]]; then
  previous_image_tag=$(<"$previous_release/.image-tag")
fi

cp "$shared_dir/.env.production" "$release_dir/.env.production"
chmod 600 "$release_dir/.env.production"
printf '%s\n' "$image_tag" > "$release_dir/.image-tag"

rollback() {
  echo 'Deployment failed; restoring the previous release.' >&2
  docker logs --tail 100 goldenevents-events-1 >&2 2>/dev/null || true

  if [[ -n "$previous_release" && -f "$previous_release/compose.yaml" ]]; then
    (
      cd "$previous_release"
      IMAGE_TAG="${previous_image_tag:-latest}" docker compose -p "$project_name" up -d --remove-orphans
    ) || true
  fi
}

trap rollback ERR

cd "$release_dir"
IMAGE_TAG="$image_tag" docker compose -p "$project_name" build
IMAGE_TAG="$image_tag" docker compose -p "$project_name" up -d --remove-orphans

container_id=$(docker compose -p "$project_name" ps -q events)
if [[ -z "$container_id" ]]; then
  echo 'Production container was not created' >&2
  exit 1
fi

for _ in $(seq 1 45); do
  status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
  if [[ "$status" == healthy ]]; then
    break
  fi
  if [[ "$status" == unhealthy || "$status" == exited || "$status" == dead ]]; then
    echo "Production container entered state: $status" >&2
    exit 1
  fi
  sleep 2
done

if [[ "$status" != healthy ]]; then
  echo "Production container did not become healthy (last state: $status)" >&2
  exit 1
fi

ln -sfn "$release_dir" "$app_root/current.next"
mv -Tf "$app_root/current.next" "$current_link"
trap - ERR

echo "Deployed $RELEASE_SHA successfully."
