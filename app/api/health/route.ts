import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const basePayload = {
    service: "matrixcrm-next-postgres-v2",
    milestone: 1,
    timestamp: new Date().toISOString(),
  };

  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      ok: true,
      ...basePayload,
      database: "connected",
    });
  } catch (error) {
    const devMessage =
      process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined;

    return NextResponse.json(
      {
        ok: false,
        ...basePayload,
        database: "disconnected",
        ...(devMessage ? { message: devMessage } : {}),
      },
      { status: 503 }
    );
  }
}
