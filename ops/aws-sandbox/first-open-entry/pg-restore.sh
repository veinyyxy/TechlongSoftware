#!/bin/bash
# PostgreSQL image pinned by SpeedFeast A's reviewed Dockerfile.lifecycle.
set -euo pipefail
image='docker.io/library/postgres:16.14-trixie@sha256:95206741a5b214807675e14165369d05b93a9cf692223b616d07cca227e74b0b'
docker=(/usr/bin/docker run --rm --pull=never --platform linux/amd64
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges
  --user "$(/usr/bin/id -u):$(/usr/bin/id -g)" --entrypoint /usr/lib/postgresql/16/bin/pg_restore)

# The existing baseline compiler needs version, archive listing and schema
# rendering to stdout. In particular this wrapper supports no database restore.
if [[ $# == 1 && $1 == --version ]]; then
  exec "${docker[@]}" "$image" --version
fi
if [[ $# == 2 && $1 == --list ]]; then
  mode=(--list)
elif [[ $# == 7 && $1 == --schema-only && $2 == --no-owner && $3 == --no-privileges &&
  $4 == --no-comments && $5 =~ ^--restrict-key=[a-f0-9]{32}$ && $6 == --file=- ]]; then
  mode=("${@:1:6}")
else
  exit 64
fi
archive="${!#}"
parent="${archive%/*}"
[[ "$parent" == /?*/first-open-fc41597f-baseline && "$archive" == "$parent/baseline.dump" &&
   "$parent" != *,* && -f "$archive" && "$(/usr/bin/realpath -e -- "$archive")" == "$archive" ]] || exit 64
exec "${docker[@]}" --mount "type=bind,src=$parent,dst=/baseline,readonly" "$image" "${mode[@]}" /baseline/baseline.dump
