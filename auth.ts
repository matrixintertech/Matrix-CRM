import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { verifyOtpChallenge } from "@/features/auth/services/otp.service";
import { env } from "@/lib/config/env";
import { loginSchema } from "@/validations/auth";

export const authOptions: NextAuthOptions = {
  secret: env().AUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "OTP",
      credentials: {
        target: {
          label: "Email or phone",
          type: "text",
        },
        code: {
          label: "OTP",
          type: "text",
        },
        purpose: {
          label: "Purpose",
          type: "text",
        },
      },
      async authorize(rawCredentials) {
        const parsed = loginSchema.safeParse(rawCredentials);
        if (!parsed.success) {
          return null;
        }

        const result = await verifyOtpChallenge({
          target: parsed.data.target,
          code: parsed.data.code,
          purpose: parsed.data.purpose,
        });

        if (!result.ok) {
          return null;
        }

        return {
          id: result.user.id,
          servicePartnerId: result.user.servicePartnerId,
          name: result.user.name,
          email: result.user.email,
          phone: result.user.phone,
          roleKeys: result.user.roleKeys,
          isSuperAdmin: result.user.isSuperAdmin,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.servicePartnerId = user.servicePartnerId;
        token.phone = user.phone ?? null;
        token.roleKeys = user.roleKeys ?? [];
        token.isSuperAdmin = user.isSuperAdmin ?? false;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.servicePartnerId = token.servicePartnerId;
        session.user.phone = token.phone;
        session.user.roleKeys = token.roleKeys;
        session.user.isSuperAdmin = token.isSuperAdmin;
      }

      return session;
    },
  },
};

export function auth() {
  return getServerSession(authOptions);
}
