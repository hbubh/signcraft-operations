import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListPartsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  MAX_FILE_SIZE,
  PART_SIZE,
  requireRole,
  type Actor,
} from "@/domain/rules";
import { objectId } from "@/domain/validation";
import { db, transaction } from "./db";
import { scopedOrder, event, conflict } from "./orders";
const s3 = () =>
  new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
const bucket = () => process.env.R2_BUCKET!;
function sign(value: string) {
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET required");
  return createHmac("sha256", process.env.AUTH_SECRET)
    .update(value)
    .digest("hex");
}
function receipt(id: string, part: number, expires: number) {
  const value = `${id}:${part}:${expires}`;
  return `${value}:${sign(value)}`;
}
function checkReceipt(value: string, id: string, part: number) {
  const [a, b, c, sig] = value.split(":");
  const unsigned = `${a}:${b}:${c}`;
  const expected = sign(unsigned);
  return (
    a === id &&
    Number(b) === part &&
    Number(c) > Date.now() &&
    !!sig &&
    sig.length === expected.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );
}
export async function uploadAction(
  actor: Actor,
  action: string,
  input: unknown,
) {
  if (action === "initiate") {
    requireRole(actor, "MANAGER");
    const data = z
      .object({
        orderId: objectId,
        originalFilename: z.string().min(1).max(180),
        declaredSize: z.number().int().positive().max(MAX_FILE_SIZE),
        contentType: z.enum([
          "application/pdf",
          "image/png",
          "image/jpeg",
          "image/tiff",
        ]),
      })
      .parse(input);
    const order = await scopedOrder(actor, data.orderId);
    if (["COMPLETED", "CANCELLED"].includes(order.status))
      throw new AppError(400, "ORDER_CLOSED", "This order is closed.");
    const mode = process.env.UPLOAD_MODE === "r2" ? "r2" : "simulation";
    const objectKey = `orders/${order.id}/${crypto.randomUUID()}`;
    const remote =
      mode === "r2"
        ? await s3().send(
            new CreateMultipartUploadCommand({
              Bucket: bucket(),
              Key: objectKey,
              ContentType: data.contentType,
            }),
          )
        : null;
    try {
      const asset = await transaction(async (tx) => {
        const created = await tx.asset.create({
          data: {
            ...data,
            uploaderId: actor.id,
            objectKey,
            mode,
            multipartUploadId: remote?.UploadId,
          },
        });
        await event(tx, actor, order.id, order.revision, "UPLOAD_STARTED");
        return created;
      });
      return {
        id: asset.id,
        mode,
        partSize: PART_SIZE,
        partCount: Math.ceil(asset.declaredSize / PART_SIZE),
      };
    } catch (error) {
      if (remote?.UploadId)
        await s3().send(
          new AbortMultipartUploadCommand({
            Bucket: bucket(),
            Key: objectKey,
            UploadId: remote.UploadId,
          }),
        );
      throw error;
    }
  }
  const { assetId } = z.object({ assetId: objectId }).parse(input);
  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new AppError(404, "NOT_FOUND", "Asset not found.");
  const order = await scopedOrder(actor, asset.orderId);
  if (action === "download") {
    if (asset.status !== "COMPLETED")
      throw new AppError(400, "ASSET_NOT_READY", "This asset is not ready.");
    if (asset.mode === "simulation")
      return {
        simulated: true,
        message: "Simulation complete. No file bytes were stored.",
      };
    return {
      url: await getSignedUrl(
        s3(),
        new GetObjectCommand({
          Bucket: bucket(),
          Key: asset.objectKey,
          ResponseContentDisposition: `attachment; filename="${asset.originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        }),
        { expiresIn: 60 },
      ),
    };
  }
  requireRole(actor, "MANAGER");
  if (asset.status !== "UPLOADING") {
    if (action === "complete" && asset.status === "COMPLETED")
      return { ok: true };
    throw conflict();
  }
  const partCount = Math.ceil(asset.declaredSize / PART_SIZE);
  if (action === "sign-parts") {
    const { parts } = z
      .object({
        parts: z.array(z.number().int().min(1).max(partCount)).min(1).max(3),
      })
      .parse(input);
    const expires = Date.now() + 300000;
    return {
      parts: await Promise.all(
        parts.map(async (part) => ({
          part,
          url:
            asset.mode === "r2"
              ? await getSignedUrl(
                  s3(),
                  new UploadPartCommand({
                    Bucket: bucket(),
                    Key: asset.objectKey,
                    UploadId: asset.multipartUploadId!,
                    PartNumber: part,
                  }),
                  { expiresIn: 300 },
                )
              : `https://simulated-storage.invalid/${asset.id}/${part}`,
          receipt:
            asset.mode === "simulation"
              ? receipt(asset.id, part, expires)
              : undefined,
        })),
      ),
    };
  }
  if (action === "abort" || action === "fail") {
    if (asset.mode === "r2")
      await s3().send(
        new AbortMultipartUploadCommand({
          Bucket: bucket(),
          Key: asset.objectKey,
          UploadId: asset.multipartUploadId!,
        }),
      );
    return transaction(async (tx) => {
      const updated = await tx.asset.updateMany({
        where: { id: asset.id, status: "UPLOADING", revision: asset.revision },
        data: {
          status: action === "abort" ? "ABORTED" : "FAILED",
          revision: { increment: 1 },
        },
      });
      if (!updated.count) throw conflict();
      await event(
        tx,
        actor,
        order.id,
        order.revision,
        action === "abort" ? "UPLOAD_ABORTED" : "UPLOAD_FAILED",
      );
      return { ok: true };
    });
  }
  if (action === "complete") {
    const { parts } = z
      .object({
        parts: z
          .array(
            z.object({
              part: z.number().int().positive(),
              etag: z.string().optional(),
              receipt: z.string().optional(),
            }),
          )
          .min(1)
          .max(128),
      })
      .parse(input);
    if (
      parts.length !== partCount ||
      new Set(parts.map((p) => p.part)).size !== partCount ||
      parts.some((p) => p.part > partCount)
    )
      throw new AppError(400, "PARTS_MISSING", "Upload parts are incomplete.");
    if (asset.mode === "simulation") {
      // This proves the simulated protocol was issued by this server, not that bytes
      // exist in storage. The API and UI explicitly label this as a simulation.
      if (
        Date.now() - asset.createdAt.getTime() < 1200 ||
        parts.some(
          (p) => !p.receipt || !checkReceipt(p.receipt, asset.id, p.part),
        )
      )
        throw new AppError(
          400,
          "INVALID_RECEIPT",
          "The simulated upload has not completed.",
        );
    } else {
      // Completion is based on provider-reported parts and object length, not client claims.
      const remote = await s3().send(
        new ListPartsCommand({
          Bucket: bucket(),
          Key: asset.objectKey,
          UploadId: asset.multipartUploadId!,
        }),
      );
      if (
        remote.Parts?.length !== partCount ||
        remote.Parts.reduce((n, p) => n + (p.Size ?? 0), 0) !==
          asset.declaredSize
      )
        throw new AppError(
          400,
          "PARTS_MISSING",
          "Storage has not received the complete file.",
        );
      await s3().send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket(),
          Key: asset.objectKey,
          UploadId: asset.multipartUploadId!,
          MultipartUpload: {
            Parts: remote.Parts.map((p) => ({
              PartNumber: p.PartNumber,
              ETag: p.ETag,
            })),
          },
        }),
      );
      const head = await s3().send(
        new HeadObjectCommand({ Bucket: bucket(), Key: asset.objectKey }),
      );
      if (head.ContentLength !== asset.declaredSize)
        throw new AppError(
          400,
          "SIZE_MISMATCH",
          "Stored file size does not match.",
        );
    }
    return transaction(async (tx) => {
      const updated = await tx.asset.updateMany({
        where: { id: asset.id, status: "UPLOADING", revision: asset.revision },
        data: {
          status: "COMPLETED",
          verifiedSize: asset.declaredSize,
          revision: { increment: 1 },
        },
      });
      if (!updated.count) throw conflict();
      await event(tx, actor, order.id, order.revision, "UPLOAD_COMPLETED");
      return { ok: true };
    });
  }
  throw new AppError(404, "NOT_FOUND", "Upload action not found.");
}
