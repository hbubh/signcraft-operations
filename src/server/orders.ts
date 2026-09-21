import { Prisma } from "@prisma/client";
import { db, transaction } from "./db";
import {
  AppError,
  assertTransition,
  requireRole,
  type Actor,
  type OrderStatus,
} from "@/domain/rules";
import { orderInput } from "@/domain/validation";
import { z } from "zod";
export const conflict = () =>
  new AppError(
    409,
    "VERSION_CONFLICT",
    "This record changed. Please refresh and try again.",
  );
export async function scopedOrder(
  actor: Actor,
  id: string,
  client: Prisma.TransactionClient = db,
) {
  if (actor.role === "INSTALLER")
    throw new AppError(404, "NOT_FOUND", "Order not found.");
  const order = await client.order.findFirst({
    where: { id, ...(actor.role === "VENDOR" ? { vendorId: actor.id } : {}) },
  });
  if (!order) throw new AppError(404, "NOT_FOUND", "Order not found.");
  return order;
}
export async function event(
  tx: Prisma.TransactionClient,
  actor: Actor,
  orderId: string,
  orderRevision: number,
  eventType: string,
  details: Prisma.InputJsonValue = {},
) {
  return tx.orderEvent.create({
    data: {
      orderId,
      actorId: actor.id,
      actorRole: actor.role,
      eventType,
      orderRevision,
      details,
    },
  });
}
export async function saveOrder(
  actor: Actor,
  input: z.output<typeof orderInput>,
  id?: string,
  revision?: number,
) {
  requireRole(actor, "MANAGER");
  const vendor = await db.user.findFirst({
    where: { id: input.vendorId, role: "VENDOR" },
  });
  if (!vendor)
    throw new AppError(400, "INVALID_VENDOR", "Select a valid vendor.");
  return transaction(async (tx) => {
    if (!id) {
      const order = await tx.order.create({
        data: { ...input, creatorId: actor.id },
      });
      await event(tx, actor, order.id, 0, "ORDER_CREATED");
      return order;
    }
    const current = await scopedOrder(actor, id, tx);
    if (current.status !== "DRAFT")
      throw new AppError(400, "DRAFT_ONLY", "Only draft orders can be edited.");
    const changed = await tx.order.updateMany({
      where: { id, revision, status: "DRAFT" },
      data: { ...input, revision: { increment: 1 } },
    });
    if (!changed.count) throw conflict();
    await event(tx, actor, id, current.revision + 1, "ORDER_UPDATED");
    return tx.order.findUniqueOrThrow({ where: { id } });
  });
}
export async function transitionOrder(
  actor: Actor,
  id: string,
  revision: number,
  target: OrderStatus,
) {
  return transaction(async (tx) => {
    const order = await scopedOrder(actor, id, tx);
    if (order.revision !== revision) throw conflict();
    const asset =
      target === "IN_PRODUCTION"
        ? await tx.asset.findFirst({
            where: { orderId: id, status: "COMPLETED" },
          })
        : null;
    assertTransition(order.status, target, actor.role, !!asset);
    const changed = await tx.order.updateMany({
      where: { id, revision, status: order.status },
      data: { status: target, revision: { increment: 1 } },
    });
    if (!changed.count) throw conflict();
    await event(
      tx,
      actor,
      id,
      revision + 1,
      target === "CANCELLED" ? "ORDER_CANCELLED" : target,
    );
    if (target === "READY_FOR_INSTALL") {
      await tx.installationJob.upsert({
        where: { orderId: id },
        create: {
          orderId: id,
          assignedInstallerId: null,
          reservedByInstallerId: null,
          claimId: null,
          expiresAt: null,
          reservedAt: null,
        },
        update: {},
      });
      await event(tx, actor, id, revision + 1, "INSTALL_JOB_CREATED");
    }
    return tx.order.findUniqueOrThrow({ where: { id } });
  });
}
export async function listOrders(actor: Actor, params: URLSearchParams) {
  requireRole(actor, "MANAGER", "VENDOR");
  const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));
  const search = (params.get("search") ?? "").slice(0, 100);
  const status = params.get("status");
  const where: Prisma.OrderWhereInput = {
    ...(actor.role === "VENDOR" ? { vendorId: actor.id } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { customerBusiness: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(status &&
    [
      "DRAFT",
      "SUBMITTED",
      "VENDOR_ACCEPTED",
      "IN_PRODUCTION",
      "READY_FOR_INSTALL",
      "COMPLETED",
      "CANCELLED",
    ].includes(status)
      ? { status: status as OrderStatus }
      : {}),
  };
  const [items, total, groups, activeUploads] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * 10,
      take: 10,
    }),
    db.order.count({ where }),
    db.order.groupBy({
      by: ["status"],
      where: actor.role === "VENDOR" ? { vendorId: actor.id } : {},
      _count: true,
    }),
    actor.role === "MANAGER"
      ? db.asset.count({ where: { status: "UPLOADING" } })
      : Promise.resolve(0),
  ]);
  return {
    items,
    total,
    page,
    counts: Object.fromEntries(groups.map((g) => [g.status, g._count])),
    activeUploads,
  };
}
export async function orderDetail(actor: Actor, id: string) {
  const order = await scopedOrder(actor, id);
  const [assets, history, job, vendor] = await Promise.all([
    db.asset.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        originalFilename: true,
        declaredSize: true,
        status: true,
        mode: true,
        createdAt: true,
      },
    }),
    db.orderEvent.findMany({
      where: { orderId: id },
      orderBy: { timestamp: "desc" },
      take: 100,
    }),
    db.installationJob.findUnique({ where: { orderId: id } }),
    db.user.findUnique({
      where: { id: order.vendorId },
      select: { name: true },
    }),
  ]);
  return { ...order, assets, history, job, vendor };
}
