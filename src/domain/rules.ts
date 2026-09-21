export const statuses = [
  "DRAFT",
  "SUBMITTED",
  "VENDOR_ACCEPTED",
  "IN_PRODUCTION",
  "READY_FOR_INSTALL",
  "COMPLETED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof statuses)[number];
export type Role = "MANAGER" | "VENDOR" | "INSTALLER";
export type Actor = { id: string; role: Role; name?: string };
export const transitions: Record<
  OrderStatus,
  Partial<Record<OrderStatus, Role>>
> = {
  DRAFT: { SUBMITTED: "MANAGER", CANCELLED: "MANAGER" },
  SUBMITTED: { VENDOR_ACCEPTED: "VENDOR", CANCELLED: "MANAGER" },
  VENDOR_ACCEPTED: { IN_PRODUCTION: "VENDOR", CANCELLED: "MANAGER" },
  IN_PRODUCTION: { READY_FOR_INSTALL: "VENDOR" },
  READY_FOR_INSTALL: {},
  COMPLETED: {},
  CANCELLED: {},
};
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireRole(actor: Actor, ...roles: Role[]) {
  if (!roles.includes(actor.role))
    throw new AppError(
      403,
      "FORBIDDEN",
      "Your account does not have permission to perform this action.",
    );
}
export function assertTransition(
  from: OrderStatus,
  to: OrderStatus,
  role: Role,
  hasAsset: boolean,
) {
  const allowedRole = transitions[from][to];
  if (!allowedRole)
    throw new AppError(
      400,
      "INVALID_TRANSITION",
      "This action is not available for the order in its current state.",
    );
  if (allowedRole !== role)
    throw new AppError(
      403,
      "FORBIDDEN",
      "Your account cannot perform this transition.",
    );
  if (to === "IN_PRODUCTION" && !hasAsset)
    throw new AppError(
      400,
      "ASSET_REQUIRED",
      "Upload a completed asset before starting production.",
    );
}
export const availableActions = (status: OrderStatus, role: Role) =>
  Object.entries(transitions[status])
    .filter(([, r]) => r === role)
    .map(([s]) => s as OrderStatus);
export const label = (value: string) =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
export const CLAIM_SECONDS = 180;
export const MAX_FILE_SIZE = 2 * 1024 ** 3;
export const PART_SIZE = 16 * 1024 ** 2;
export function logicallyAvailable(
  job: { status: string; expiresAt: Date | string | null },
  now = new Date(),
) {
  return (
    job.status === "AVAILABLE" ||
    (job.status === "RESERVED" &&
      !!job.expiresAt &&
      new Date(job.expiresAt) <= now)
  );
}
