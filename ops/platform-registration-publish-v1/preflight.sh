#!/usr/bin/env bash
# One fixed original image, shared original load/smoke/scan gates; no rebuild.
set -euo pipefail
test "$#" -eq 0
driver=ops/platform-registration-publish-v1/artifact.mjs
out="$RUNNER_TEMP/sandbox-registration-publication-v1"
image_id=$(node --input-type=module -e 'import {selectOverlayPublication} from "./ops/platform-registration-publish-v1/contract.mjs"; const e=process.env;const {protocol,review}=selectOverlayPublication(e.TECHLONG_PUBLICATION_REVIEW,e.TECHLONG_PUBLICATION_SHA);protocol.validateCloud(e,review);console.log(protocol.P.imageConfigDigest)')
node "$driver" prepare "$out"
gzip -dc "$out/image.tar.gz" | docker load
docker image inspect "$image_id" > "$out/loaded-inspect.json"
node "$driver" inspect "$out"
for mode in loopback https; do
  name="platform-publication-${GITHUB_RUN_ID}-${mode}"
  extra=()
  if [ "$mode" = https ]; then extra=(--env TECHLONG_PLATFORM_INGRESS=alb-https-v1 --env TECHLONG_PLATFORM_PUBLIC_ORIGIN=https://console.sandbox.techlong.cloud); fi
  closed=(--env AWS_INITIALIZED_REQUESTS_ENABLED=false --env DEPLOYMENT_WORKER_ENABLED=false --env AWS_APPLY_ENABLED=false --env TECHLONG_PLATFORM_CONTROLLER_ENABLED=false --env TECHLONG_PLATFORM_CONTROL_LOCAL=false --env TECHLONG_PLATFORM_CONTROL_HOSTED=false --env TECHLONG_PLATFORM_CONTROLLER_LEASE= --env TECHLONG_PLATFORM_REQUEST_WINDOW_V6=)
  docker run "${closed[@]}" --detach --name "$name" --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --memory 1g --cpus 1 "${extra[@]}" "$image_id"
  trap 'docker rm --force "$name"' EXIT
  test "$(docker exec "$name" id -u)" != 0
  if [ "$mode" = https ]; then
    docker exec "$name" node ops/platform-hosting-v1/https-smoke.mjs
    docker exec "$name" node --input-type=module -e '
      import assert from "node:assert/strict";
      import { request } from "node:http";
      import { CLOSED_BINDINGS } from "./ops/platform-hosting-v1/contract.mjs";
      for (const [k,v] of Object.entries(CLOSED_BINDINGS)) assert.equal(process.env[k],v);
      assert.equal(process.env.DATABASE_URL,undefined);
      const html=await new Promise((resolve,reject)=>{
        const req=request({hostname:"127.0.0.1",port:3000,method:"GET",path:"/register",timeout:5000,
          headers:{host:"console.sandbox.techlong.cloud","x-forwarded-proto":"https","x-forwarded-port":"443"}},res=>{
          if(res.statusCode!==200){res.resume();reject(Error("REGISTRATION_FORM_HTTP"));return;}
          let text="";res.setEncoding("utf8");res.on("data",c=>{text+=c;if(text.length>1024*1024)req.destroy(Error("REGISTRATION_FORM_LIMIT"));});
          res.on("end",()=>resolve(text));
        });req.on("error",reject);req.on("timeout",()=>req.destroy(Error("REGISTRATION_FORM_TIMEOUT")));req.end();
      });
      assert.match(html,/workspaceName/);'
  else
    docker exec "$name" node ops/platform-hosting-v1/smoke.mjs
  fi
  docker rm --force "$name"
  trap - EXIT
done
scanner=$(mktemp -d "$RUNNER_TEMP/platform-publication-trivy.XXXXXX")
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 https://github.com/aquasecurity/trivy/releases/download/v0.75.0/trivy_0.75.0_Linux-64bit.tar.gz --output "$scanner/trivy.tar.gz"
echo "c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f  $scanner/trivy.tar.gz" | sha256sum --check --strict
tar --extract --gzip --file "$scanner/trivy.tar.gz" --directory "$scanner" trivy
touch "$scanner/empty.ignore"
set +e
(cd "$scanner" && env -i PATH="$PATH" DOCKER_CONFIG="$scanner/docker-config" "$scanner/trivy" image --image-src docker --scanners vuln --pkg-types os --severity HIGH,CRITICAL --exit-code 1 --format json --list-all-pkgs --ignorefile "$scanner/empty.ignore" --cache-dir "$scanner/cache" --timeout 8m --output "$out/os-scan.json" "$image_id")
scan_exit=$?
set -e
node "$driver" scan "$out" "$scanner/cache"
test "$scan_exit" -eq 0
