#!/usr/bin/env bash
set -euo pipefail

BOOTSTRAP="docker-compose.yml"
SECURE="docker-compose.secure.yml"
DATA_DIR="../data"

echo "=== PHASE 1: BOOTSTRAP (no auth) ==="

echo "[1/7] Stop everything..."
docker compose -f "$BOOTSTRAP" down -v >/dev/null 2>&1 || true
docker compose -f "$SECURE" down -v >/dev/null 2>&1 || true

echo "[2/7] Cleaning data..."
rm -rf "$DATA_DIR"
mkdir -p "$DATA_DIR"

echo "[3/7] Start bootstrap cluster..."
docker compose -f "$BOOTSTRAP" up -d

echo "[4/7] Waiting for mongo-init..."

TIMEOUT=300
MONGO_INIT_ID=""

while [ $TIMEOUT -gt 0 ]; do
  MONGO_INIT_ID="$(docker compose -f "$BOOTSTRAP" ps -q mongo-init)"
  if [ -n "$MONGO_INIT_ID" ]; then
    STATUS="$(docker inspect --format='{{.State.Status}}' "$MONGO_INIT_ID" 2>/dev/null || true)"
    if [ "$STATUS" = "exited" ]; then
      break
    fi
  fi

  sleep 1
  TIMEOUT=$((TIMEOUT - 1))
done

if [ $TIMEOUT -le 0 ]; then
  echo "Timeout waiting for mongo-init"
  exit 1
fi

EXITCODE="$(docker inspect --format='{{.State.ExitCode}}' "$MONGO_INIT_ID")"

if [ "$EXITCODE" = "0" ]; then
  echo "mongo-init finished successfully."
else
  echo "mongo-init FAILED with code $EXITCODE"
  docker compose -f "$BOOTSTRAP" logs --tail=200 mongo-init
  exit 1
fi

echo "[4.5/7] Checking mongo-import..."

MONGO_IMPORT_ID="$(docker compose -f "$BOOTSTRAP" ps -q mongo-import)"
if [ -z "$MONGO_IMPORT_ID" ]; then
  echo "mongo-import container not found"
  exit 1
fi

IMPORT_EXIT="$(docker inspect --format='{{.State.ExitCode}}' "$MONGO_IMPORT_ID" 2>/dev/null || true)"

if [ "$IMPORT_EXIT" != "0" ]; then
  echo "mongo-import FAILED with code $IMPORT_EXIT"
  docker compose -f "$BOOTSTRAP" logs --tail=200 mongo-import
  exit 1
fi

echo "mongo-import OK"

echo "[5/7] Stopping bootstrap cluster..."
docker compose -f "$BOOTSTRAP" down

echo
echo "=== PHASE 2: SECURE (auth + keyfile) ==="

echo "[6/7] Skipping keyfile generation (handled inside containers)"

echo "[7/7] Starting secure cluster..."
docker compose -f "$SECURE" up -d

echo "Waiting for mongos..."

TIMEOUT=120
MONGOS_ID=""

while [ $TIMEOUT -gt 0 ]; do
  MONGOS_ID="$(docker compose -f "$SECURE" ps -q mongos1)"
  if [ -n "$MONGOS_ID" ]; then
    if docker logs "$MONGOS_ID" 2>&1 | grep -q "waiting for connections"; then
      echo "mongos is ready"
      break
    fi
  fi

  sleep 2
  TIMEOUT=$((TIMEOUT - 2))
done

if [ $TIMEOUT -le 0 ]; then
  echo "Timeout waiting for mongos"
  if [ -n "$MONGOS_ID" ]; then
    docker logs "$MONGOS_ID"
  fi
  exit 1
fi

echo
echo "=== FINAL STATUS ==="
docker compose -f "$SECURE" ps

echo
echo "CLUSTER READY"
echo "Mongo: mongodb://admin@localhost:27017/admin"
echo "Mongo Express: http://localhost:8082"