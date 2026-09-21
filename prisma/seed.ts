import { PrismaClient, OrderStatus, Role } from "@prisma/client";
import { hash } from "bcryptjs";
import { MongoClient } from "mongodb";
const db = new PrismaClient();
export async function seed() {
  const passwordHash = await hash("SignCraft!2026", 12);
  const users: [string, string, Role][] = [
    ["manager", "Alex Morgan", "MANAGER"],
    ["vendor1", "Northline Print Studio", "VENDOR"],
    ["vendor2", "Forma Fabrication", "VENDOR"],
    ["installer1", "Jordan Lee", "INSTALLER"],
    ["installer2", "Sam Rivera", "INSTALLER"],
    ["installer3", "Casey Brooks", "INSTALLER"],
  ];
  const accounts = [];
  for (const [email, name, role] of users)
    accounts.push(
      await db.user.upsert({
        where: { email: `${email}@signcraft.demo` },
        create: { email: `${email}@signcraft.demo`, name, role, passwordHash },
        update: {},
      }),
    );
  const examples: [string, string, OrderStatus][] = [
    ["Storefront dimensional letters", "Olive & Oak", "IN_PRODUCTION"],
    ["Lobby wayfinding system", "Meridian House", "SUBMITTED"],
    ["Window graphics refresh", "Sunday Coffee", "DRAFT"],
    ["Exterior monument sign", "Lumen Park", "READY_FOR_INSTALL"],
    ["Retail wall graphics", "Fieldwork Supply", "VENDOR_ACCEPTED"],
    ["Building entrance signage", "Cedar Collective", "READY_FOR_INSTALL"],
    ["Reception feature wall", "Studio Form", "COMPLETED"],
    ["Seasonal menu boards", "The Good Table", "IN_PRODUCTION"],
    ["Campus directional signs", "Westhaven Works", "READY_FOR_INSTALL"],
    ["Event entrance display", "Common Ground", "CANCELLED"],
  ];
  for (let i = 0; i < examples.length; i++) {
    const [title, customerBusiness, status] = examples[i];
    const id = (100 + i).toString(16).padStart(24, "0");
    if (await db.order.findUnique({ where: { id } })) continue;
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + i + 2);
    const order = await db.order.create({
      data: {
        id,
        title,
        customerBusiness,
        status,
        customerContactName: "Taylor Quinn",
        customerContactEmail: `hello${i}@example.com`,
        signageDescription:
          "Custom fabricated signage with a satin finish. Confirm dimensions against approved artwork before production.",
        quantity: (i % 3) + 1,
        installationAddress: `${120 + i * 7} Market Street, Portland`,
        requestedInstallationDate: day.toISOString().slice(0, 10),
        price: 125000 + i * 32500,
        notes: "Coordinate site access with the front desk.",
        vendorId: accounts[1 + (i % 2)].id,
        creatorId: accounts[0].id,
      },
    });
    await db.orderEvent.create({
      data: {
        orderId: id,
        actorId: accounts[0].id,
        actorRole: "MANAGER",
        eventType: "DEMO_ORDER_SEEDED",
        orderRevision: 0,
        details: { status },
      },
    });
    if (!["DRAFT", "SUBMITTED", "CANCELLED"].includes(status))
      await db.asset.create({
        data: {
          orderId: id,
          uploaderId: accounts[0].id,
          objectKey: `demo/${id}/artwork`,
          originalFilename: `${customerBusiness.toLowerCase().replaceAll(" ", "-")}-artwork.pdf`,
          declaredSize: 1342177280,
          verifiedSize: 1342177280,
          contentType: "application/pdf",
          mode: "simulation",
          status: "COMPLETED",
        },
      });
    if (["READY_FOR_INSTALL", "COMPLETED"].includes(status))
      await db.installationJob.create({
        data: {
          orderId: order.id,
          status: status === "COMPLETED" ? "COMPLETED" : "AVAILABLE",
          assignedInstallerId: status === "COMPLETED" ? accounts[3].id : null,
          reservedByInstallerId: null,
          claimId: null,
          reservedAt: null,
          expiresAt: null,
          completedAt: status === "COMPLETED" ? new Date() : null,
        },
      });
  }
  const mongo = await new MongoClient(process.env.DATABASE_URL!).connect();
  try {
    await mongo
      .db()
      .collection("LoginAttempt")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  } finally {
    await mongo.close();
  }
  console.log(
    "Seed ready: 6 demo accounts and 10 fictional orders. See README for demo access.",
  );
}
seed().finally(() => db.$disconnect());
