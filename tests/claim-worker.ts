import { claimJob } from "../src/server/jobs";
import { db } from "../src/server/db";
const [jobId, actorId] = process.argv.slice(2);
const results = await Promise.allSettled(
  Array.from({ length: 10 }, () =>
    claimJob({ id: actorId, role: "INSTALLER" }, jobId),
  ),
);
console.log(
  JSON.stringify(
    results.map((r) =>
      r.status === "fulfilled" ? 200 : (r.reason.status ?? 500),
    ),
  ),
);
await db.$disconnect();
