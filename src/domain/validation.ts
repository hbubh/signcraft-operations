import { z } from "zod";
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid record ID");
export const revision = z.number().int().nonnegative();
export const orderInput = z.object({
  title: z.string().trim().min(3).max(120),
  customerBusiness: z.string().trim().min(2).max(120),
  customerContactName: z.string().trim().min(2).max(100),
  customerContactEmail: z.email().max(200),
  signageDescription: z.string().trim().min(3).max(2000),
  quantity: z.number().int().min(1).max(10000),
  installationAddress: z.string().trim().min(5).max(300),
  requestedInstallationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (v) =>
        !Number.isNaN(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v,
      "Enter a valid date",
    ),
  price: z.number().int().min(0).max(100000000),
  notes: z.string().max(3000).default(""),
  vendorId: objectId,
});
