# Matrix CRM Next + PostgreSQL v2

Next.js App Router CRM with PostgreSQL, Prisma, role-based access control, and OTP-based authentication.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create the env file from placeholders:

```bash
cp .env.example .env
```

3. Validate Prisma and generate the client:

```bash
npm run db:validate
npm run db:generate
```

4. Run local migrations if needed:

```bash
npm run db:migrate
```

5. Start the app:

```bash
npm run dev
```

## Production env

Required:

- `DATABASE_URL`
- `NEXT_PUBLIC_APP_URL`
- `AUTH_SECRET` or `NEXTAUTH_SECRET`

Strongly recommended:

- `DIRECT_URL`
- `AUTH_URL` or `NEXTAUTH_URL`

OTP delivery:

- `OTP_DELIVERY_CHANNEL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`

Rate limiting:

- `RATE_LIMIT_DRIVER`
- `UPSTASH_REDIS_REST_URL` when `RATE_LIMIT_DRIVER=upstash`
- `UPSTASH_REDIS_REST_TOKEN` when `RATE_LIMIT_DRIVER=upstash`
- `ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION=false` by default

Health diagnostics:

- `HEALTH_SHOW_DETAILS=false` by default

Seed/bootstrap:

- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PHONE`
- `PLATFORM_SERVICE_PARTNER_CODE`
- `PLATFORM_SERVICE_PARTNER_NAME`
- `SEED_DEV_TEST_USERS=false` in production

## Neon database guidance

- Use a pooled Neon connection in `DATABASE_URL` for the running app.
- Use the non-pooler Neon connection in `DIRECT_URL` for migrations and other direct schema operations.
- Keep SSL enabled in both URLs.
- Leave `PRISMA_USE_NEON_ADAPTER` unset to allow automatic selection. Local Windows development with Neon will automatically use the WebSocket adapter; production keeps the native Prisma driver by default.
- Set `PRISMA_USE_NEON_ADAPTER=true` to force the Neon WebSocket adapter or `PRISMA_USE_NEON_ADAPTER=false` to force the native Prisma driver.

## OTP authentication

- Login stays OTP-based.
- Production-safe OTP delivery is email-based through SMTP when `OTP_DELIVERY_CHANNEL=email`.
- Phone login identifiers still work if the matched active user has an email address for OTP delivery.
- `OTP_DEV_MODE` must remain `false` in production.
- OTP previews are only returned in non-production when `OTP_DEV_MODE=true`.

## Rate limiting

- Local development can use in-memory rate limiting.
- Production should use `RATE_LIMIT_DRIVER=upstash`.
- If you intentionally allow memory rate limiting in production, set `ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION=true`.

## Deploy scripts

Key commands:

```bash
npm run db:validate
npm run db:generate
npm run db:migrate:deploy
npm run build
npm run start
npm run prod:check
```

## Vercel checklist

- Set the project root to `matrixcrm-next-postgres-v2`.
- Use Node.js 20.
- Configure all required env vars in the Vercel project.
- Run `npx prisma migrate deploy` during deployment or as a pre-deploy step.
- Verify SMTP and Upstash credentials before turning production traffic on.

## VPS / Hostinger checklist

1. Install Node.js 20.
2. Run `npm ci`.
3. Run `npm run db:generate`.
4. Run `npm run db:migrate:deploy`.
5. Run `npm run build`.
6. Start with `npm run start` behind HTTPS and a process manager.
7. Configure production env vars on the host.

## Seed guidance

- `npm run db:seed` uses `prisma/seed.ts`.
- Seed will upsert the platform tenant and RBAC baseline.
- Seed can create a bootstrap super admin if bootstrap env vars are provided.
- Seed does not create dev test users in production.

## QA commands

```bash
npm run qa:production-readiness
npm run qa:access
npm run qa:service-requests
npm run qa:quotations
npm run qa:procurement
npm run qa:purchase-orders
npm run qa:invoices
npm run qa:payments
npm run qa:ledger
npm run qa:vendor-payments
npm run qa:finance-reports
```

## Production checklist

- Node 20 is used everywhere.
- `DATABASE_URL` and `DIRECT_URL` point to the correct Neon hosts.
- `AUTH_SECRET` is set to a strong value.
- `OTP_DEV_MODE=false`.
- SMTP env vars are complete and tested.
- Shared rate limiting is configured for production.
- Migrations are deployed before serving traffic.
- `.env` is not committed.
