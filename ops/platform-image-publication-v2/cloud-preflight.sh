#!/usr/bin/env bash
# Same exact-image check shared by No-AWS CI and the future protected publisher.
set -euo pipefail
mode=${1:?mode required}
case "$mode" in
  preflight) prepare=prepare ;;
  publication) prepare=prepare-publication ;;
  *) exit 64 ;;
esac
out="$RUNNER_TEMP/platform-publication-v2"
node ops/platform-image-publication-v2/artifact.mjs "$prepare" "$out"
image_id=$(node --input-type=module -e 'import {P} from "./ops/platform-image-publication-v2/plan.mjs"; console.log(P.imageConfigDigest)')
gzip -dc "$out/image.tar.gz" | docker load
docker image inspect "$image_id" > "$out/loaded-inspect.json"
node ops/platform-image-publication-v2/artifact.mjs inspect "$out"
for mode in loopback https; do
  name="platform-publication-${GITHUB_RUN_ID}-${mode}"
  extra=()
  if [ "$mode" = https ]; then extra=(--env TECHLONG_PLATFORM_INGRESS=alb-https-v1 --env TECHLONG_PLATFORM_PUBLIC_ORIGIN=https://console.sandbox.techlong.cloud); fi
  docker run --detach --name "$name" --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --memory 1g --cpus 1 "${extra[@]}" "$image_id"
  trap 'docker rm --force "$name"' EXIT
  test "$(docker exec "$name" id -u)" != 0
  if [ "$mode" = https ]; then docker exec "$name" node ops/platform-hosting-v1/https-smoke.mjs; else docker exec "$name" node ops/platform-hosting-v1/smoke.mjs; fi
  docker rm --force "$name"
  trap - EXIT
done
scanner=$(mktemp -d "$RUNNER_TEMP/platform-publication-trivy.XXXXXX")
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 https://github.com/aquasecurity/trivy/releases/download/v0.75.0/trivy_0.75.0_Linux-64bit.tar.gz --output "$scanner/trivy.tar.gz"
echo "c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f  $scanner/trivy.tar.gz" | sha256sum --check --strict
tar --extract --gzip --file "$scanner/trivy.tar.gz" --directory "$scanner" trivy
touch "$scanner/empty.ignore"
set +e
(cd "$scanner" && env -i PATH="$PATH" HOME="$HOME" DOCKER_CONFIG="$scanner/docker-config" "$scanner/trivy" image --image-src docker --scanners vuln --pkg-types os --severity HIGH,CRITICAL --exit-code 1 --format json --list-all-pkgs --ignorefile "$scanner/empty.ignore" --cache-dir "$scanner/cache" --timeout 8m --output "$out/os-scan.json" "$image_id")
scan_exit=$?
set -e
node ops/platform-image-publication-v2/artifact.mjs scan "$out" "$scanner/cache"
test "$scan_exit" -eq 0
