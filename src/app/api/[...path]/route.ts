import { api, actor } from "@/server/http";
import {
  listOrders,
  orderDetail,
  saveOrder,
  transitionOrder,
} from "@/server/orders";
import { claimJob, completeJob, listJobs, verifyJob } from "@/server/jobs";
import { db } from "@/server/db";
import { AppError, requireRole, statuses } from "@/domain/rules";
import { objectId, orderInput, revision } from "@/domain/validation";
import { z } from "zod";
import { uploadAction } from "@/server/uploads";
export const runtime = "nodejs";
const route = api(async (request) => {
  const user = await actor();
  const url = new URL(request.url);
  const [, , resource, id, action, kind] = url.pathname.split("/");
  const method = request.method;
  if (resource === "me") return user;
  if (resource === "vendors" && method === "GET") {
    requireRole(user, "MANAGER");
    return db.user.findMany({
      where: { role: "VENDOR" },
      select: { id: true, name: true },
    });
  }
  if (resource === "orders") {
    if (!id && method === "GET") return listOrders(user, url.searchParams);
    if (!id && method === "POST")
      return saveOrder(user, orderInput.parse(await request.json()));
    objectId.parse(id);
    if (!action && method === "GET") return orderDetail(user, id);
    if (!action && method === "PATCH") {
      const data = z
        .object({ revision })
        .and(orderInput)
        .parse(await request.json());
      return saveOrder(user, data, id, data.revision);
    }
    if (action === "transition" && method === "POST") {
      const data = z
        .object({ revision, status: z.enum(statuses) })
        .parse(await request.json());
      return transitionOrder(user, id, data.revision, data.status);
    }
  }
  if (resource === "install-jobs") {
    if (!id && method === "GET") return listJobs(user);
    objectId.parse(id);
    if (method === "POST" && action === "claim") return claimJob(user, id);
    if (method === "POST" && action === "complete") {
      const data = z.object({ revision }).parse(await request.json());
      return completeJob(user, id, data.revision);
    }
    if (method === "POST" && action === "verify") {
      const type = z.enum(["identity", "payment"]).parse(kind);
      const data = z
        .object({
          claimId: z.string().uuid(),
          revision,
          fail: z.boolean().default(false),
        })
        .parse(await request.json());
      return verifyJob(user, id, data.claimId, data.revision, type, data.fail);
    }
  }
  if (resource === "uploads" && method === "POST")
    return uploadAction(user, id, await request.json());
  throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
});
export const GET = route;
export const POST = route;
export const PATCH = route;
