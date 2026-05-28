import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const basePayload = {
    service: "matrixcrm-next-postgres-v2",
    milestone: 1,
    timestamp: new Date().toISOString(),
  };

  try {
    await prisma.$connect();
    await prisma.servicePartner.findFirst({
      select: { id: true },
    });

    return NextResponse.json({
      ok: true,
      ...basePayload,
      database: "connected",
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
          : rawMessage.includes("TLS connection")
            ? "tls_error"
            : "database_error");
    const devMessage =
      process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined;

    return NextResponse.json(
      {
        ok: false,
        ...basePayload,
        database: "disconnected",
        reason,
        ...(devMessage ? { message: devMessage } : {}),
      },
      { status: 503 }
    );
  }
}
