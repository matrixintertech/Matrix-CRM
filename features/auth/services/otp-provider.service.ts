import type { OtpPurpose } from "@prisma/client";

import { env } from "@/lib/config/env";

type OtpChannel = "EMAIL" | "SMS";

type SendOtpMessageInput = {
  channel: OtpChannel;
  target: string;
  code: string;
  purpose: OtpPurpose;
};

type SendOtpMessageResult =
  | {
      ok: true;
      mode: "dev" | "provider";
    }
  | {
      ok: false;
      code: "PROVIDER_NOT_CONFIGURED";
    };

export async function sendOtpMessage(input: SendOtpMessageInput): Promise<SendOtpMessageResult> {
  const config = env();

  if (config.OTP_DEV_MODE && !config.IS_PRODUCTION) {
    return { ok: true, mode: "dev" };
  }

  // Real SMS/email provider integrations are intentionally not wired yet.
  const _unused = input;
  return { ok: false, code: "PROVIDER_NOT_CONFIGURED" };
}

