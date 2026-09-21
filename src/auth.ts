import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import type { Role } from "@/domain/rules";
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const parsed = z
          .object({
            email: z.email().max(200),
            password: z.string().min(1).max(128),
          })
          .safeParse(credentials);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();
        const now = Date.now();
        const key = createHash("sha256")
          .update(`${email}:${Math.floor(now / 900000)}`)
          .digest("hex");
        const attempt = await db.loginAttempt.upsert({
          where: { id: key },
          create: { id: key, count: 1, expiresAt: new Date(now + 900000) },
          update: { count: { increment: 1 } },
        });
        if (attempt.count > 15) return null;
        const user = await db.user.findUnique({ where: { email } });
        const valid = await compare(
          parsed.data.password,
          user?.passwordHash ??
            "$2b$12$C6UzMDM.H6dfI/f/IKcEe.0.OtRlfM6LhHBRFHAF.qTUrGOvI5K6G",
        );
        if (!user || !valid) return null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user as typeof user & { role: Role }).role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub!;
      (session.user as typeof session.user & { role: Role }).role =
        token.role as Role;
      return session;
    },
  },
});
