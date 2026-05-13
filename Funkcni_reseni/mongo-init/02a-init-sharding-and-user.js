function sleep(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {}
}

function waitMongo(uri) {
  for (let i = 0; i < 180; i++) {
    try {
      const conn = new Mongo(uri);
      const res = conn.getDB("admin").runCommand({ ping: 1 });
      if (res.ok === 1) return;
    } catch (e) {}
    sleep(1000);
  }
  throw new Error("Mongo not ready: " + uri);
}

function safe(label, fn) {
  try {
    const res = fn();
    print("[OK] " + label);
    if (res) printjson(res);
  } catch (e) {
    print("[SKIP] " + label + " -> " + e);
  }
}

waitMongo("mongodb://mongos1:27017");

const admin = new Mongo("mongodb://mongos1:27017").getDB("admin");

safe("add shard1", () =>
  admin.runCommand({
    addShard: "shard1RS/shard1_primary:27017,shard1_secondary1:27017,shard1_secondary2:27017"
  })
);

safe("add shard2", () =>
  admin.runCommand({
    addShard: "shard2RS/shard2_primary:27017,shard2_secondary1:27017,shard2_secondary2:27017"
  })
);

safe("add shard3", () =>
  admin.runCommand({
    addShard: "shard3RS/shard3_primary:27017,shard3_secondary1:27017,shard3_secondary2:27017"
  })
);

safe("enable sharding db", () =>
  admin.runCommand({ enableSharding: "steam_bd" })
);

safe("create admin user", () => {
  const usersInfo = admin.runCommand({ usersInfo: "admin" });
  const exists = (usersInfo.users || []).some(u => u.user === "admin");
  if (exists) {
    return { ok: 1, msg: "admin already exists" };
  }

  return admin.createUser({
    user: "admin",
    pwd: "adminpass",
    roles: [{ role: "root", db: "admin" }]
  });
});

print("SHARDING READY");