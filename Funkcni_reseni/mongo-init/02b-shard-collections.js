function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitMongo(uri, timeoutSec = 240) {
  for (let i = 0; i < timeoutSec; i++) {
    try {
      const conn = new Mongo(uri);
      const res = conn.getDB("admin").runCommand({ ping: 1 });
      if (res.ok === 1) return;
    } catch (e) {}
    await sleep(1000);
  }
  throw new Error("Mongo not reachable: " + uri);
}

function safe(label, fn) {
  try {
    const res = fn();
    print(`[OK] ${label}`);
    if (res && typeof res === "object") printjson(res);
    return res;
  } catch (e) {
    print(`[SKIP] ${label}: ${e}`);
    return null;
  }
}

async function moveChunkWithRetry(adminDb, label, command, retries = 12, delayMs = 5000) {
  command._waitForDelete = true;

  for (let i = 1; i <= retries; i++) {
    try {
      const res = adminDb.runCommand(command);
      print(`[OK] ${label} attempt ${i}`);
      printjson(res);
      return res;
    } catch (e) {
      print(`[RETRY] ${label} attempt ${i}/${retries}: ${e}`);
      await sleep(delayMs);
    }
  }

  throw new Error(`${label} failed after ${retries} attempts`);
}

async function waitCollection(conn, dbName, collName, timeoutSec = 600) {
  for (let i = 0; i < timeoutSec; i++) {
    try {
      const db = conn.getDB(dbName);
      if (db.getCollectionNames().includes(collName)) return;
    } catch (e) {}
    await sleep(1000);
  }
  throw new Error(`Collection not found after ${timeoutSec}s: ${dbName}.${collName}`);
}

function getSplitKeys(coll, field) {
  const values = coll.distinct(field)
    .filter(v => typeof v === "string" && v.length > 0)
    .sort();

  if (values.length < 3) {
    throw new Error(`Not enough distinct values in ${coll.getName()}.${field}`);
  }

  return {
    k1: values[Math.floor(values.length / 3)],
    k2: values[Math.floor((2 * values.length) / 3)],
    first: values[0],
    middle: values[Math.floor(values.length / 2)],
    last: values[values.length - 1]
  };
}

function getRankingDocsForMove(coll, firstKey, middleKey, lastKey) {
  const d1 = coll.findOne({ game_name_norm: firstKey });
  const d2 = coll.findOne({ game_name_norm: middleKey });
  const d3 = coll.findOne({ game_name_norm: lastKey });

  if (!d1 || !d2 || !d3) {
    throw new Error("Could not find ranking documents for moveChunk");
  }

  return [d1, d2, d3];
}

(async () => {
  const uri = "mongodb://admin:adminpass@mongos1:27017/admin?authSource=admin";
  await waitMongo(uri, 240);

  const conn = new Mongo(uri);
  const admin = conn.getDB("admin");
  const steam = conn.getDB("steam_bd");

  safe("enableSharding steam_bd", () =>
    admin.runCommand({ enableSharding: "steam_bd" })
  );

  await waitCollection(conn, "steam_bd", "games", 900);
  await waitCollection(conn, "steam_bd", "reviews", 900);
  await waitCollection(conn, "steam_bd", "ranking", 900);

  safe("createIndex games(game_name_norm)", () =>
    steam.games.createIndex(
      { game_name_norm: 1 },
      { name: "idx_games_game_name_norm" }
    )
  );

  safe("createIndex reviews(game_name_norm)", () =>
    steam.reviews.createIndex(
      { game_name_norm: 1 },
      { name: "idx_reviews_game_name_norm" }
    )
  );

  safe("createIndex ranking(game_name_norm, rank_type)", () =>
    steam.ranking.createIndex(
      { game_name_norm: 1, rank_type: 1 },
      { name: "idx_ranking_game_name_norm_rank_type" }
    )
  );

  safe("shardCollection steam_bd.games", () =>
    admin.runCommand({
      shardCollection: "steam_bd.games",
      key: { game_name_norm: 1 }
    })
  );

  safe("shardCollection steam_bd.reviews", () =>
    admin.runCommand({
      shardCollection: "steam_bd.reviews",
      key: { game_name_norm: 1 }
    })
  );

  safe("shardCollection steam_bd.ranking", () =>
    admin.runCommand({
      shardCollection: "steam_bd.ranking",
      key: { game_name_norm: 1, rank_type: 1 }
    })
  );

  await sleep(3000);

  // ===== GAMES =====
  const gameKeys = getSplitKeys(steam.games, "game_name_norm");

  safe(`split games at ${gameKeys.k1}`, () =>
    admin.runCommand({
      split: "steam_bd.games",
      middle: { game_name_norm: gameKeys.k1 }
    })
  );

  safe(`split games at ${gameKeys.k2}`, () =>
    admin.runCommand({
      split: "steam_bd.games",
      middle: { game_name_norm: gameKeys.k2 }
    })
  );

  await moveChunkWithRetry(admin, "moveChunk games -> shard1RS", {
    moveChunk: "steam_bd.games",
    find: { game_name_norm: gameKeys.first },
    to: "shard1RS"
  });

  await moveChunkWithRetry(admin, "moveChunk games -> shard2RS", {
    moveChunk: "steam_bd.games",
    find: { game_name_norm: gameKeys.middle },
    to: "shard2RS"
  });

  await moveChunkWithRetry(admin, "moveChunk games -> shard3RS", {
    moveChunk: "steam_bd.games",
    find: { game_name_norm: gameKeys.last },
    to: "shard3RS"
  });

  // ===== REVIEWS =====
  const reviewKeys = getSplitKeys(steam.reviews, "game_name_norm");

  safe(`split reviews at ${reviewKeys.k1}`, () =>
    admin.runCommand({
      split: "steam_bd.reviews",
      middle: { game_name_norm: reviewKeys.k1 }
    })
  );

  safe(`split reviews at ${reviewKeys.k2}`, () =>
    admin.runCommand({
      split: "steam_bd.reviews",
      middle: { game_name_norm: reviewKeys.k2 }
    })
  );

  await moveChunkWithRetry(admin, "moveChunk reviews -> shard1RS", {
    moveChunk: "steam_bd.reviews",
    find: { game_name_norm: reviewKeys.first },
    to: "shard1RS"
  });

  await moveChunkWithRetry(admin, "moveChunk reviews -> shard2RS", {
    moveChunk: "steam_bd.reviews",
    find: { game_name_norm: reviewKeys.middle },
    to: "shard2RS"
  });

  await moveChunkWithRetry(admin, "moveChunk reviews -> shard3RS", {
    moveChunk: "steam_bd.reviews",
    find: { game_name_norm: reviewKeys.last },
    to: "shard3RS"
  });

  // ===== RANKING =====
  const rankingKeys = getSplitKeys(steam.ranking, "game_name_norm");

  safe(`split ranking at ${rankingKeys.k1}`, () =>
    admin.runCommand({
      split: "steam_bd.ranking",
      middle: { game_name_norm: rankingKeys.k1, rank_type: MinKey() }
    })
  );

  safe(`split ranking at ${rankingKeys.k2}`, () =>
    admin.runCommand({
      split: "steam_bd.ranking",
      middle: { game_name_norm: rankingKeys.k2, rank_type: MinKey() }
    })
  );

  const [r1, r2, r3] = getRankingDocsForMove(
    steam.ranking,
    rankingKeys.first,
    rankingKeys.middle,
    rankingKeys.last
  );

  await moveChunkWithRetry(admin, "moveChunk ranking -> shard1RS", {
    moveChunk: "steam_bd.ranking",
    find: { game_name_norm: r1.game_name_norm, rank_type: r1.rank_type },
    to: "shard1RS"
  });

  await moveChunkWithRetry(admin, "moveChunk ranking -> shard2RS", {
    moveChunk: "steam_bd.ranking",
    find: { game_name_norm: r2.game_name_norm, rank_type: r2.rank_type },
    to: "shard2RS"
  });

  await moveChunkWithRetry(admin, "moveChunk ranking -> shard3RS", {
    moveChunk: "steam_bd.ranking",
    find: { game_name_norm: r3.game_name_norm, rank_type: r3.rank_type },
    to: "shard3RS"
  });

  print("02b done.");
})();