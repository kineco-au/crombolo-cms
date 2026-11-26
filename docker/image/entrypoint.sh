#!/bin/sh
# The image's start (story 087): the site at /site when one was built in, else the one in
# /data/site, made from CROMBOLO_TEMPLATE the first time /data is empty. State in /data.
set -e

export CROMBOLO_SQLITE_FILE="${CROMBOLO_SQLITE_FILE:-/data/crombolo.sqlite}"
export CROMBOLO_MEDIA_DIR="${CROMBOLO_MEDIA_DIR:-/data/media}"
export CROMBOLO_LOGS_DIR="${CROMBOLO_LOGS_DIR:-/data/logs}"

if [ -f /site/package.json ]; then
  # Built in: its files are the image's, changed by building another.
  cd /site
  export CROMBOLO_SCHEMA_WRITABLE="${CROMBOLO_SCHEMA_WRITABLE:-false}"
else
  if [ ! -f /data/site/package.json ]; then
    mkdir -p /data/site
    cd /data/site
    template="${CROMBOLO_TEMPLATE:-empty}"
    if [ "$template" = empty ]; then
      crombolo init --name "${CROMBOLO_SITE_NAME:-My site}" --empty
    else
      crombolo init --name "${CROMBOLO_SITE_NAME:-My site}" --template "$template"
    fi
  fi
  cd /data/site
  # The image's crombolo, which the site's own package.json names.
  [ -e node_modules ] || ln -s /opt/crombolo/node_modules node_modules
  export CROMBOLO_SCHEMA_WRITABLE="${CROMBOLO_SCHEMA_WRITABLE:-true}"
fi

exec crombolo start "$@"
