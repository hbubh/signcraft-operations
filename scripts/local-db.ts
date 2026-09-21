import { MongoMemoryReplSet } from "mongodb-memory-server";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { MongoClient } from "mongodb";
async function main() {
  await mkdir(".local/mongo", { recursive: true });
  const repl = await MongoMemoryReplSet.create({
    instanceOpts: [{ port: 27027, dbPath: ".local/mongo" }],
    replSet: { count: 1, storageEngine: "wiredTiger", name: "rs0" },
  });
  const uri = repl.getUri("signcraft");
  try {
    await readFile(".env");
  } catch {
    await writeFile(
      ".env",
      `DATABASE_URL=${uri}\nAUTH_SECRET=${randomBytes(32).toString("hex")}\nAUTH_URL=http://localhost:3000\nAUTH_TRUST_HOST=true\nUPLOAD_MODE=simulation\nDEMO_MODE=true\n`,
    );
  }
  const mongo = await new MongoClient(uri).connect();
  await mongo
    .db()
    .collection("LoginAttempt")
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await mongo.close();
  console.log(
    "Local MongoDB replica set ready on port 27027. Data lives in .local/mongo.",
  );
  const stop = async () => {
    await repl.stop({ doCleanup: false });
    process.exit();
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
