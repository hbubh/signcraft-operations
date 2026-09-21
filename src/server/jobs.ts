import { db, transaction } from "./db";
import { event, conflict } from "./orders";
import {
  AppError,
  CLAIM_SECONDS,
  logicallyAvailable,
  requireRole,
  type Actor,
} from "@/domain/rules";
import type { InstallationJob } from "@prisma/client";
function publicJob(job: InstallationJob, actor: Actor, now = new Date()) {
  const available = logicallyAvailable(job, now);
  const mine =
    !available &&
    (job.reservedByInstallerId === actor.id ||
      job.assignedInstallerId === actor.id);
  return {
    id: job.id,
    orderId: job.orderId,
    status: available ? "AVAILABLE" : job.status,
    revision: job.revision,
    expiresAt:
      !available && (mine || actor.role === "MANAGER") ? job.expiresAt : null,
    claimId: mine && job.status === "RESERVED" ? job.claimId : null,
    identityVerificationStatus: mine
      ? job.identityVerificationStatus
      : "NOT_STARTED",
    paymentVerificationStatus: mine
      ? job.paymentVerificationStatus
      : "NOT_STARTED",
    mine,
  };
}
export async function listJobs(actor: Actor) {
  requireRole(actor, "MANAGER", "INSTALLER");
  const now = new Date();
  const jobs = await db.installationJob.findMany({
    where:
      actor.role === "MANAGER"
        ? {}
        : {
            OR: [
              { status: "AVAILABLE" },
              { status: "RESERVED", expiresAt: { lte: now } },
              { reservedByInstallerId: actor.id },
              { assignedInstallerId: actor.id },
            ],
          },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const orders = await db.order.findMany({
    where: { id: { in: jobs.map((j) => j.orderId) } },
    select: {
      id: true,
      title: true,
      customerBusiness: true,
      installationAddress: true,
      requestedInstallationDate: true,
      price: true,
      quantity: true,
      status: true,
    },
  });
  return {
    serverNow: now.toISOString(),
    items: jobs
      .map((job) => ({
        ...publicJob(job, actor, now),
        order: orders.find((o) => o.id === job.orderId),
      }))
      .filter(
        (j) =>
          j.order &&
          (j.order.status === "READY_FOR_INSTALL" || j.status === "COMPLETED"),
      ),
  };
}
export async function claimJob(actor: Actor, id: string) {
  requireRole(actor, "INSTALLER");
  return transaction(async (tx) => {
    const now = new Date();
    const claimId = crypto.randomUUID();
    const job = await tx.installationJob.findUnique({ where: { id } });
    if (!job) throw new AppError(404, "NOT_FOUND", "Job not found.");
    const order = await tx.order.findFirst({
      where: { id: job.orderId, status: "READY_FOR_INSTALL" },
    });
    if (!order)
      throw new AppError(
        409,
        "JOB_UNAVAILABLE",
        "This job is no longer available.",
      );
    // MongoDB's conditional write, inside the same transaction as the audit event,
    // is the arbiter. No process-local locks or read/check/write ownership decisions.
    const changed = await tx.installationJob.updateMany({
      where: {
        id,
        assignedInstallerId: null,
        OR: [
          { status: "AVAILABLE" },
          { status: "RESERVED", expiresAt: { lte: now } },
        ],
      },
      data: {
        status: "RESERVED",
        claimId,
        reservedByInstallerId: actor.id,
        assignedInstallerId: null,
        reservedAt: now,
        expiresAt: new Date(now.getTime() + CLAIM_SECONDS * 1000),
        identityVerificationStatus: "NOT_STARTED",
        paymentVerificationStatus: "NOT_STARTED",
        revision: { increment: 1 },
      },
    });
    if (!changed.count)
      throw new AppError(
        409,
        "JOB_CLAIMED",
        "This job was just claimed by another installer. Refresh the job list.",
      );
    if (job.status === "RESERVED")
      await event(
        tx,
        actor,
        job.orderId,
        order.revision,
        "RESERVATION_EXPIRED",
      );
    await event(tx, actor, job.orderId, order.revision, "INSTALL_JOB_RESERVED");
    return publicJob(
      await tx.installationJob.findUniqueOrThrow({ where: { id } }),
      actor,
      now,
    );
  });
}
export async function verifyJob(
  actor: Actor,
  id: string,
  claimId: string,
  revision: number,
  kind: "identity" | "payment",
  fail = false,
) {
  requireRole(actor, "INSTALLER");
  if (fail && process.env.DEMO_MODE !== "true")
    throw new AppError(
      400,
      "DEMO_DISABLED",
      "Demo failure controls are disabled.",
    );
  return transaction(async (tx) => {
    const now = new Date();
    const job = await tx.installationJob.findFirst({
      where: { id, reservedByInstallerId: actor.id },
    });
    if (!job) throw new AppError(404, "NOT_FOUND", "Reservation not found.");
    if (
      job.status !== "RESERVED" ||
      job.claimId !== claimId ||
      !job.expiresAt ||
      job.expiresAt <= now ||
      job.revision !== revision
    )
      throw conflict();
    if (kind === "payment" && job.identityVerificationStatus !== "PASSED")
      throw new AppError(
        400,
        "IDENTITY_REQUIRED",
        "Complete identity verification first.",
      );
    const order = await tx.order.findUniqueOrThrow({
      where: { id: job.orderId },
    });
    const changed = await tx.installationJob.updateMany({
      where: {
        id,
        status: "RESERVED",
        claimId,
        reservedByInstallerId: actor.id,
        revision,
        expiresAt: { gt: new Date() },
      },
      data: fail
        ? {
            status: "AVAILABLE",
            claimId: null,
            reservedByInstallerId: null,
            reservedAt: null,
            expiresAt: null,
            identityVerificationStatus: "NOT_STARTED",
            paymentVerificationStatus: "NOT_STARTED",
            revision: { increment: 1 },
          }
        : kind === "identity"
          ? { identityVerificationStatus: "PASSED", revision: { increment: 1 } }
          : {
              paymentVerificationStatus: "PASSED",
              status: "ASSIGNED",
              assignedInstallerId: actor.id,
              expiresAt: null,
              revision: { increment: 1 },
            },
    });
    if (!changed.count) throw conflict();
    await event(
      tx,
      actor,
      job.orderId,
      order.revision,
      fail
        ? "RESERVATION_RELEASED"
        : `${kind.toUpperCase()}_VERIFICATION_PASSED`,
      fail ? { reason: "Simulated verification failed" } : {},
    );
    if (!fail && kind === "payment")
      await event(tx, actor, job.orderId, order.revision, "INSTALLER_ASSIGNED");
    return publicJob(
      await tx.installationJob.findUniqueOrThrow({ where: { id } }),
      actor,
    );
  });
}
export async function completeJob(actor: Actor, id: string, revision: number) {
  requireRole(actor, "INSTALLER");
  return transaction(async (tx) => {
    const job = await tx.installationJob.findFirst({
      where: { id, assignedInstallerId: actor.id },
    });
    if (!job) throw new AppError(404, "NOT_FOUND", "Installation not found.");
    if (job.status !== "ASSIGNED" || job.revision !== revision)
      throw conflict();
    const order = await tx.order.findUniqueOrThrow({
      where: { id: job.orderId },
    });
    const updated = await tx.order.updateMany({
      where: {
        id: order.id,
        status: "READY_FOR_INSTALL",
        revision: order.revision,
      },
      data: { status: "COMPLETED", revision: { increment: 1 } },
    });
    if (!updated.count) throw conflict();
    const changed = await tx.installationJob.updateMany({
      where: {
        id,
        status: "ASSIGNED",
        assignedInstallerId: actor.id,
        revision,
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        revision: { increment: 1 },
      },
    });
    if (!changed.count) throw conflict();
    await event(tx, actor, order.id, order.revision + 1, "ORDER_COMPLETED");
    return { ok: true };
  });
}
