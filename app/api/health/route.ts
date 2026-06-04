import { NextResponse } from "next/server";

import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";

function canShowHealthDetails() {
  const config = env();
  return config.HEALTH_SHOW_DETAILS && !config.IS_PRODUCTION;
}

function sanitizeErrorMessage(message: string) {
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted_url]")
    .replace(/(password|token|secret)=\S+/gi, "$1=[redacted]");
}

export async function GET() {
  const basePayload = {
    service: "matrixcrm-next-postgres-v2",
    milestone: 1,
    timestamp: new Date().toISOString(),
  };
  const includeDetails = canShowHealthDetails();

  try {
    await prisma.$connect();
    await prisma.servicePartner.findFirst({
      select: { id: true },
    });

    return NextResponse.json({
      ok: true,
      ...basePayload,
      database: "connected",
      ...(includeDetails
        ? {
            details: {
              nodeEnv: env().NODE_ENV,
              otpDeliveryChannel: env().OTP_DELIVERY_CHANNEL,
              rateLimitDriver: env().RATE_LIMIT_DRIVER,
            },
          }
        : {}),
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const errorCode =
      typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    const reason =
      errorCode ??
      (rawMessage.includes("Can't reach database server")
        ? "database_unreachable"
        : rawMessage.includes("Timed out fetching a new connection")
          ? "pool_timeout"
          : rawMessage.includes("No credentials are available in the security package")
            ? "windows_tls_credential_error"
          : rawMessage.includes("TLS connection")
            ? "tls_error"
            : "database_error");
    const safeMessage = includeDetails ? sanitizeErrorMessage(rawMessage).slice(0, 240) : undefined;

    return NextResponse.json(
      {
        ok: false,
        ...basePayload,
        database: "disconnected",
        reason,
        ...(safeMessage ? { message: safeMessage } : {}),
      },
      { status: 503 }
    );
  }
}
