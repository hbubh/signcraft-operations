import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Dashboard from "@/components/dashboard";
import { db } from "@/server/db";
export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, role: true },
  });
  if (!user) redirect("/login");
  return <Dashboard user={user} demo={process.env.DEMO_MODE === "true"} />;
}
