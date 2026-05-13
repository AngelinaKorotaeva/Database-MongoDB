#!/usr/bin/env bash
set -euo pipefail

echo "=============================="
echo " MONGO INIT SAFE START"
echo "=============================="

wait_mongo() {
  local host=$1

  for i in {1..180}; do
    if mongosh --host "$host" --quiet --eval "db.adminCommand({ ping: 1 }).ok" 2>/dev/null | grep -q 1; then
      echo "$host OK"
      return
    fi
    echo "waiting $host..."
    sleep 2
  done

  echo "ERROR: $host not ready"
  exit 1
}

wait_uri() {
  local uri=$1
  local name=$2

  for i in {1..180}; do
    if mongosh "$uri" --quiet --eval "db.adminCommand({ ping: 1 }).ok" 2>/dev/null | grep -q 1; then
      echo "$name OK"
      return
    fi
    echo "waiting $name..."
    sleep 2
  done

  echo "ERROR: $name not ready"
  exit 1
}

echo "== WAIT CONFIGS =="
wait_mongo configsvr1
wait_mongo configsvr2
wait_mongo configsvr3

echo "== WAIT SHARDS =="
for h in \
shard1_primary shard1_secondary1 shard1_secondary2 \
shard2_primary shard2_secondary1 shard2_secondary2 \
shard3_primary shard3_secondary1 shard3_secondary2
do
  wait_mongo "$h"
done

echo "== INIT REPLICA SETS =="
mongosh --host configsvr1 --quiet /mongo-init/01-init-replsets.js

echo "== WAIT MONGOS ROUTERS =="
wait_uri "mongodb://mongos1:27017" "mongos1"
wait_uri "mongodb://mongos2:27017" "mongos2"

echo "== INIT SHARDING + USER =="
mongosh "mongodb://mongos1:27017/admin" --quiet /mongo-init/02a-init-sharding-and-user.js

echo "== WAIT CLUSTER METADATA =="
for i in {1..120}; do
  COUNT=$(mongosh "mongodb://mongos1:27017/admin" --quiet --eval "db.adminCommand({ listShards: 1 }).shards.length" 2>/dev/null || echo 0)

  if [ "$COUNT" = "3" ]; then
    echo "All 3 shards are visible"
    break
  fi

  echo "waiting shards metadata... current shards: $COUNT"
  sleep 2

  if [ "$i" = "120" ]; then
    echo "ERROR: shards metadata not ready"
    exit 1
  fi
done

echo "== FLUSH ROUTER CONFIG =="
mongosh "mongodb://mongos1:27017/admin" --quiet --eval "db.adminCommand({ flushRouterConfig: 1 })" || true
mongosh "mongodb://mongos2:27017/admin" --quiet --eval "db.adminCommand({ flushRouterConfig: 1 })" || true

echo "== FINAL STABILIZATION WAIT =="
sleep 15

echo "=============================="
echo " MONGO INIT DONE SAFE"
echo "=============================="