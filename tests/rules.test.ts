import { describe, it, expect } from "vitest";
import {
  assertTransition,
  statuses,
  transitions,
  logicallyAvailable,
  availableActions,
} from "../src/domain/rules";
import { orderInput } from "../src/domain/validation";
describe("order state machine", () => {
  for (const from of statuses)
    for (const to of statuses) {
      const role = transitions[from][to];
      it(`${from} → ${to}: ${role ? "allowed" : "rejected"}`, () => {
        if (role)
          expect(() => assertTransition(from, to, role, true)).not.toThrow();
        else
          expect(() => assertTransition(from, to, "MANAGER", true)).toThrow(
            expect.objectContaining({ status: 400 }),
          );
      });
    }
  it("rejects production without a completed asset", () =>
    expect(() =>
      assertTransition("VENDOR_ACCEPTED", "IN_PRODUCTION", "VENDOR", false),
    ).toThrow(expect.objectContaining({ code: "ASSET_REQUIRED" })));
  it("rejects the wrong role", () =>
    expect(() =>
      assertTransition("SUBMITTED", "VENDOR_ACCEPTED", "INSTALLER", true),
    ).toThrow(expect.objectContaining({ status: 403 })));
  it("only presents authorized actions", () =>
    expect(availableActions("SUBMITTED", "VENDOR")).toEqual([
      "VENDOR_ACCEPTED",
    ]));
  it("normalizes expired reservations but preserves assigned jobs", () => {
    const expiresAt = new Date(0);
    expect(logicallyAvailable({ status: "RESERVED", expiresAt })).toBe(true);
    expect(logicallyAvailable({ status: "ASSIGNED", expiresAt })).toBe(false);
  });
  it("validates calendar dates", () =>
    expect(
      orderInput.shape.requestedInstallationDate.safeParse("2026-02-30")
        .success,
    ).toBe(false));
});
