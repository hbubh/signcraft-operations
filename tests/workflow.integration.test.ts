import { beforeAll, afterAll, it, expect } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { ObjectId } from "mongodb";
import { type Actor } from "../src/domain/rules";
let repl: MongoMemoryReplSet;
let db: PrismaClient;
let jobs: typeof import("../src/server/jobs");
let orders: typeof import("../src/server/orders");
let uploads: typeof import("../src/server/uploads");
const manager: Actor = { id: new ObjectId().toString(), role: "MANAGER" };
const vendor: Actor = { id: new ObjectId().toString(), role: "VENDOR" };
const installer: Actor = { id: new ObjectId().toString(), role: "INSTALLER" };
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  process.env.DATABASE_URL = repl.getUri("integration");
  process.env.AUTH_SECRET = "integration-test-only-secret-32-characters";
  process.env.DEMO_MODE = "true";
  process.env.UPLOAD_MODE = "simulation";
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
    { env: process.env },
  );
  db = new PrismaClient();
  jobs = await import("../src/server/jobs");
  orders = await import("../src/server/orders");
  uploads = await import("../src/server/uploads");
  await db.user.create({
    data: {
      id: vendor.id,
      email: "vendor@test.local",
      name: "Test vendor",
      role: "VENDOR",
      passwordHash: "unused",
    },
  });
});
afterAll(async () => {
  await db?.$disconnect();
  const shared = await import("../src/server/db");
  await shared.db.$disconnect();
  await repl?.stop();
});
async function ready() {
  const order = await db.order.create({
    data: {
      title: "Test signage",
      customerBusiness: "Test business",
      customerContactName: "Test person",
      customerContactEmail: "test@example.com",
      signageDescription: "Test description",
      quantity: 1,
      installationAddress: "12 Test Street",
      requestedInstallationDate: "2026-12-01",
      price: 10000,
      vendorId: vendor.id,
      creatorId: manager.id,
      status: "READY_FOR_INSTALL",
    },
  });
  const job = await db.installationJob.create({
    data: {
      orderId: order.id,
      assignedInstallerId: null,
      expiresAt: null,
      claimId: null,
      reservedByInstallerId: null,
      reservedAt: null,
    },
  });
  return { order, job };
}
it("20 independent contenders yield exactly 1 winner and 19 conflicts", async () => {
  const { job } = await ready();
  const actors = Array.from({ length: 20 }, () => ({
    id: new ObjectId().toString(),
    role: "INSTALLER" as const,
  }));
  const results = await Promise.allSettled(
    actors.map((a) => jobs.claimJob(a, job.id)),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    results.filter((r) => r.status === "rejected" && r.reason.status === 409),
  ).toHaveLength(19);
  const winner = results.findIndex((r) => r.status === "fulfilled");
  const stored = await db.installationJob.findUniqueOrThrow({
    where: { id: job.id },
  });
  expect(stored.reservedByInstallerId).toBe(actors[winner].id);
  expect(stored.expiresAt!.getTime() - stored.reservedAt!.getTime()).toBe(
    180000,
  );
  expect(
    await db.orderEvent.count({
      where: { orderId: job.orderId, eventType: "INSTALL_JOB_RESERVED" },
    }),
  ).toBe(1);
});
it("independent Node processes still produce exactly one winner", async () => {
  const { job } = await ready();
  const outputs = await Promise.all(
    [1, 2].map(() =>
      promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          "tests/claim-worker.ts",
          job.id,
          new ObjectId().toString(),
        ],
        { env: process.env },
      ),
    ),
  );
  const statuses = outputs.flatMap(
    (o) => JSON.parse(o.stdout.trim()) as number[],
  );
  expect(statuses.filter((s) => s === 200)).toHaveLength(1);
  expect(statuses.filter((s) => s === 409)).toHaveLength(19);
});
it("expired claims can be replaced and old claim IDs cannot affect the new owner", async () => {
  const { job } = await ready();
  const old = await jobs.claimJob(installer, job.id);
  await db.installationJob.update({
    where: { id: job.id },
    data: { expiresAt: new Date(0) },
  });
  const other: Actor = { id: new ObjectId().toString(), role: "INSTALLER" };
  expect(
    (await jobs.listJobs(other)).items.find((j) => j.id === job.id)?.status,
  ).toBe("AVAILABLE");
  await expect(
    jobs.verifyJob(installer, job.id, old.claimId!, old.revision, "identity"),
  ).rejects.toMatchObject({ status: 409 });
  const replacement = await jobs.claimJob(other, job.id);
  await expect(
    jobs.verifyJob(installer, job.id, old.claimId!, old.revision, "identity"),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    (await db.installationJob.findUniqueOrThrow({ where: { id: job.id } }))
      .claimId,
  ).toBe(replacement.claimId);
});
it("verification ownership, sequence, revisions, assignment and completion are enforced", async () => {
  const { job, order } = await ready();
  const claimed = await jobs.claimJob(installer, job.id);
  await expect(
    jobs.verifyJob(
      { ...installer, id: new ObjectId().toString() },
      job.id,
      claimed.claimId!,
      claimed.revision,
      "identity",
    ),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    jobs.verifyJob(
      installer,
      job.id,
      claimed.claimId!,
      claimed.revision,
      "payment",
    ),
  ).rejects.toMatchObject({ status: 400 });
  const identity = await jobs.verifyJob(
    installer,
    job.id,
    claimed.claimId!,
    claimed.revision,
    "identity",
  );
  await expect(
    jobs.verifyJob(
      installer,
      job.id,
      claimed.claimId!,
      claimed.revision,
      "payment",
    ),
  ).rejects.toMatchObject({ status: 409 });
  const assigned = await jobs.verifyJob(
    installer,
    job.id,
    claimed.claimId!,
    identity.revision,
    "payment",
  );
  expect(assigned.status).toBe("ASSIGNED");
  await expect(
    jobs.claimJob({ ...installer, id: new ObjectId().toString() }, job.id),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    jobs.completeJob(
      { ...installer, id: new ObjectId().toString() },
      job.id,
      assigned.revision,
    ),
  ).rejects.toMatchObject({ status: 404 });
  await jobs.completeJob(installer, job.id, assigned.revision);
  expect(
    (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status,
  ).toBe("COMPLETED");
  expect(
    (await db.installationJob.findUniqueOrThrow({ where: { id: job.id } }))
      .status,
  ).toBe("COMPLETED");
});
it("verification failure releases the reservation", async () => {
  const { job } = await ready();
  const claim = await jobs.claimJob(installer, job.id);
  const released = await jobs.verifyJob(
    installer,
    job.id,
    claim.claimId!,
    claim.revision,
    "identity",
    true,
  );
  expect(released.status).toBe("AVAILABLE");
  expect(
    (await db.installationJob.findUniqueOrThrow({ where: { id: job.id } }))
      .reservedByInstallerId,
  ).toBeNull();
});
it("role and resource scopes prevent vendor and installer access", async () => {
  const { job, order } = await ready();
  await expect(jobs.claimJob(vendor, job.id)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    orders.orderDetail({ ...vendor, id: new ObjectId().toString() }, order.id),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    orders.transitionOrder(installer, order.id, 0, "COMPLETED"),
  ).rejects.toMatchObject({ status: 404 });
  const list = await jobs.listJobs(installer);
  expect(JSON.stringify(list)).not.toContain("customerContactEmail");
  expect(JSON.stringify(list)).not.toContain("test@example.com");
});
it("production gate, stale edits, legal transitions and unique jobs work", async () => {
  const input = {
    title: "New signage",
    customerBusiness: "Example",
    customerContactName: "Person",
    customerContactEmail: "p@example.com",
    signageDescription: "Good sign",
    quantity: 2,
    installationAddress: "14 Main Street",
    requestedInstallationDate: "2026-12-02",
    price: 10000,
    notes: "",
    vendorId: vendor.id,
  };
  let o = await orders.saveOrder(manager, input);
  await expect(
    orders.transitionOrder(manager, o.id, 0, "IN_PRODUCTION"),
  ).rejects.toMatchObject({ status: 400 });
  await orders.saveOrder(
    manager,
    { ...input, title: "Updated signage" },
    o.id,
    0,
  );
  await expect(orders.saveOrder(manager, input, o.id, 0)).rejects.toMatchObject(
    { status: 409 },
  );
  o = await orders.transitionOrder(manager, o.id, 1, "SUBMITTED");
  o = await orders.transitionOrder(vendor, o.id, o.revision, "VENDOR_ACCEPTED");
  await expect(
    orders.transitionOrder(vendor, o.id, o.revision, "IN_PRODUCTION"),
  ).rejects.toMatchObject({ code: "ASSET_REQUIRED" });
  await db.asset.create({
    data: {
      orderId: o.id,
      uploaderId: manager.id,
      objectKey: crypto.randomUUID(),
      originalFilename: "test.pdf",
      declaredSize: 42,
      contentType: "application/pdf",
      mode: "simulation",
      status: "COMPLETED",
    },
  });
  o = await orders.transitionOrder(vendor, o.id, o.revision, "IN_PRODUCTION");
  await expect(
    orders.transitionOrder(manager, o.id, o.revision, "CANCELLED"),
  ).rejects.toMatchObject({ status: 400 });
  await orders.transitionOrder(vendor, o.id, o.revision, "READY_FOR_INSTALL");
  await expect(
    orders.transitionOrder(vendor, o.id, o.revision, "READY_FOR_INSTALL"),
  ).rejects.toMatchObject({ status: 409 });
  expect(await db.installationJob.count({ where: { orderId: o.id } })).toBe(1);
});
it("upload simulation requires server-issued receipts, respects limits and aborts", async () => {
  const { order } = await ready();
  await expect(
    uploads.uploadAction(manager, "initiate", {
      orderId: order.id,
      originalFilename: "huge.pdf",
      declaredSize: 3 * 1024 ** 3,
      contentType: "application/pdf",
    }),
  ).rejects.toThrow();
  const init = (await uploads.uploadAction(manager, "initiate", {
    orderId: order.id,
    originalFilename: "test.pdf",
    declaredSize: 1024,
    contentType: "application/pdf",
  })) as { id: string };
  await expect(
    uploads.uploadAction(installer, "download", { assetId: init.id }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    uploads.uploadAction(manager, "complete", {
      assetId: init.id,
      parts: [{ part: 1, receipt: "forged" }],
    }),
  ).rejects.toMatchObject({ status: 400 });
  await uploads.uploadAction(manager, "abort", { assetId: init.id });
  expect(
    (await db.asset.findUniqueOrThrow({ where: { id: init.id } })).status,
  ).toBe("ABORTED");
  await expect(
    uploads.uploadAction(manager, "complete", {
      assetId: init.id,
      parts: [{ part: 1 }],
    }),
  ).rejects.toMatchObject({ status: 409 });
});
