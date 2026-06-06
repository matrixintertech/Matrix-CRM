import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { otpMessages, sendOtpChallenge } from "@/features/auth/services/otp.service";
import { failure } from "@/lib/http/api-response";
import { otpSendSchema } from "@/validations/auth";

function getRequestIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? null;
  }

  return request.headers.get("x-real-ip");
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(failure("VALIDATION_ERROR", "Invalid JSON body."), { status: 400 });
  }

  const parsed = otpSendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(failure("VALIDATION_ERROR", "Invalid OTP request."), { status: 400 });
  }

  let result;
  try {
    result = await sendOtpChallenge({
      target: parsed.data.target,
      purpose: parsed.data.purpose,
      ipAddress: getRequestIp(request),
      userAgent: request.headers.get("user-agent"),
    });
  } catch (error) {
    console.error("OTP send request failed.", {
      reason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    return NextResponse.json(failure("INTERNAL_ERROR", "Unable to process OTP request right now."), { status: 500 });
  }

  if (!result.ok) {
    return NextResponse.json(
      failure(result.code, result.message),
      {
        status: result.status,
        headers: result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds) } : undefined,
      }
    );
  }

  return NextResponse.json({
    ok: true,
    message: otpMessages.genericSend,
    data: {
      maskedTarget: result.maskedTarget,
      expiresInSeconds: result.expiresInSeconds,
      resendAfterSeconds: result.resendAfterSeconds,
      ...(result.devOtpPreview ? { devOtpPreview: result.devOtpPreview } : {}),
    },
  });
}
