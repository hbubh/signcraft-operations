import { auth } from "@/auth";
import { db } from "./db";
import { AppError, type Actor } from "@/domain/rules";
import { ZodError } from "zod";
export async function actor(): Promise<Actor> {
  const session = await auth();
  if (!session?.user?.id)
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "Your session is not active. Please sign in again.",
    );
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, role: true },
  });
  if (!user)
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "Your session is not active. Please sign in again.",
    );
  return user;
}
export function api(fn: (request: Request) => Promise<unknown>) {
  return async (request: Request) => {
    try {
      if (!["GET", "HEAD"].includes(request.method)) {
        const origin = request.headers.get("origin");
        if (
          origin &&
          origin !== new URL(request.url).origin &&
          origin !== process.env.AUTH_URL
        )
          throw new AppError(
            403,
            "ORIGIN_REJECTED",
            "Request origin is not allowed.",
          );
      }
      const result = await fn(request);
      return result instanceof Response
        ? result
        : Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof AppError)
        return Response.json(
          { code: error.code, message: error.message },
          { status: error.status },
        );
      if (error instanceof ZodError || error instanceof SyntaxError)
        return Response.json(
          {
            code: "INVALID_INPUT",
            message: "Please check the submitted fields.",
          },
          { status: 400 },
        );
      console.error("Request failed", {
        requestId: crypto.randomUUID(),
        type: error instanceof Error ? error.name : "Unknown",
      });
      return Response.json(
        {
          code: "OPERATION_FAILED",
          message: "We could not complete the operation. Please try again.",
        },
        { status: 500 },
      );
    }
  };
}
