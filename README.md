# Matrix CRM Next + PostgreSQL v2 (Milestone 1)

This project is the new foundation for Matrix CRM using:

- Next.js App Router + TypeScript (strict mode)
- PostgreSQL + Prisma ORM
- Auth.js baseline wiring
- Tailwind CSS

## Milestone 1 scope

Implemented in this milestone:

- Project bootstrap and folder structure
- Base app/auth/dashboard layouts
- Health route
- Auth.js route wiring (`app/api/auth/[...nextauth]/route.ts`)
- Prisma schema foundation
- Prisma client singleton
- Seed skeleton (platform tenant, super admin role, permission/nav/settings skeleton)

Not implemented yet:

- Full OTP send/verify flow
- Business feature modules
- Full RBAC enforcement across pages/actions

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Validate Prisma schema:

```bash
npx prisma validate
```

4. Generate Prisma client:

```bash
npx prisma generate
```

5. Run migration (requires valid `DATABASE_URL`):

```bash
npx prisma migrate dev --name init
```

6. Run app:

```bash
npm run dev
```

## Notes

- `User.servicePartnerId` is required by design.
- Auth.js is configured as baseline with credentials-compatible flow only.
- OAuth/magic-link auto-user creation is intentionally not enabled in Milestone 1.
- `LedgerSourceType` excludes `MANUAL` in v1 to avoid unconstrained ledger sources until manual journals are explicitly implemented.