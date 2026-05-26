import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      servicePartnerId: string;
      phone?: string | null;
      roleKeys: string[];
      isSuperAdmin: boolean;
    };
  }

  interface User {
    id: string;
    servicePartnerId: string;
    phone?: string | null;
    roleKeys?: string[];
    isSuperAdmin?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    servicePartnerId: string;
    phone?: string | null;
    roleKeys: string[];
    isSuperAdmin: boolean;
  }
}
