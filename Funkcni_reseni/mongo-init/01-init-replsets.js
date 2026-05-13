print("=== SAFE REPLSET INIT ===");

function sleep(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {}
}

function initRS(uri, cfg) {
  const conn = new Mongo(uri);
  const admin = conn.getDB("admin");

  try {
    const st = admin.runCommand({ replSetGetStatus: 1 });
    if (st.ok === 1) {
      print(cfg._id + " already initialized");
      return;
    }
  } catch (e) {}

  print("INIT " + cfg._id);
  printjson(admin.runCommand({ replSetInitiate: cfg }));
}

function waitAnyPrimary(hosts, name, timeoutSec = 300) {
  for (let i = 0; i < timeoutSec; i++) {
    for (const uri of hosts) {
      try {
        const conn = new Mongo(uri);
        const admin = conn.getDB("admin");
        const hello = admin.runCommand({ hello: 1 });

        if (hello.ok === 1 && hello.isWritablePrimary === true) {
          print(name + " PRIMARY READY at " + uri);
          return;
        }
      } catch (e) {}
    }

    if (i % 5 === 0) {
      print("waiting PRIMARY for " + name + " ...");
    }
    sleep(1000);
  }

  throw new Error("No PRIMARY for " + name);
}

initRS("mongodb://configsvr1:27017/admin", {
  _id: "cfgRS",
  configsvr: true,
  members: [
    { _id: 0, host: "configsvr1:27017", priority: 2 },
    { _id: 1, host: "configsvr2:27017", priority: 1 },
    { _id: 2, host: "configsvr3:27017", priority: 1 }
  ]
});

initRS("mongodb://shard1_primary:27017/admin", {
  _id: "shard1RS",
  members: [
    { _id: 0, host: "shard1_primary:27017", priority: 2 },
    { _id: 1, host: "shard1_secondary1:27017", priority: 1 },
    { _id: 2, host: "shard1_secondary2:27017", priority: 1 }
  ]
});

initRS("mongodb://shard2_primary:27017/admin", {
  _id: "shard2RS",
  members: [
    { _id: 0, host: "shard2_primary:27017", priority: 2 },
    { _id: 1, host: "shard2_secondary1:27017", priority: 1 },
    { _id: 2, host: "shard2_secondary2:27017", priority: 1 }
  ]
});

initRS("mongodb://shard3_primary:27017/admin", {
  _id: "shard3RS",
  members: [
    { _id: 0, host: "shard3_primary:27017", priority: 2 },
    { _id: 1, host: "shard3_secondary1:27017", priority: 1 },
    { _id: 2, host: "shard3_secondary2:27017", priority: 1 }
  ]
});

waitAnyPrimary([
  "mongodb://configsvr1:27017/admin",
  "mongodb://configsvr2:27017/admin",
  "mongodb://configsvr3:27017/admin"
], "cfgRS");

waitAnyPrimary([
  "mongodb://shard1_primary:27017/admin",
  "mongodb://shard1_secondary1:27017/admin",
  "mongodb://shard1_secondary2:27017/admin"
], "shard1RS");

waitAnyPrimary([
  "mongodb://shard2_primary:27017/admin",
  "mongodb://shard2_secondary1:27017/admin",
  "mongodb://shard2_secondary2:27017/admin"
], "shard2RS");

waitAnyPrimary([
  "mongodb://shard3_primary:27017/admin",
  "mongodb://shard3_secondary1:27017/admin",
  "mongodb://shard3_secondary2:27017/admin"
], "shard3RS");

print("ALL REPLICA SETS READY");