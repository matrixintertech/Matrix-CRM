import nodemailer from "nodemailer";
import type { OtpPurpose } from "@prisma/client";

import { env } from "@/lib/config/env";
import { maskTarget } from "@/lib/security/mask";

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
      code: "PROVIDER_NOT_CONFIGURED" | "DELIVERY_FAILED";
    };

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type SendEmailResult =
  | {
      ok: true;
      mode: "dev" | "provider";
    }
  | {
      ok: false;
      code: "PROVIDER_NOT_CONFIGURED" | "DELIVERY_FAILED";
    };

function getOtpEmailSubject(purpose: OtpPurpose) {
  switch (purpose) {
    case "ADMIN_LOGIN":
      return "Matrix CRM admin sign-in code";
    case "PASSWORD_RESET":
      return "Matrix CRM password reset code";
    case "EMAIL_CHANGE":
      return "Matrix CRM email change verification code";
    default:
      return "Matrix CRM sign-in code";
  }
}

function buildEmailTransport() {
  const config = env();

  if (!config.SMTP_CONFIGURED) {
    return null;
  }

  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASSWORD,
    },
  });
}

async function sendEmailOtp(target: string, code: string, purpose: OtpPurpose): Promise<SendOtpMessageResult> {
  const config = env();
  return sendTransactionalEmail({
    to: target,
    subject: getOtpEmailSubject(purpose),
    text: [
      "Your Matrix CRM verification code is below.",
      "",
      code,
      "",
      `This code expires in ${config.OTP_EXPIRY_SECONDS} seconds.`,
      "If you did not request this code, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
        <p style="margin: 0 0 12px;">Your Matrix CRM verification code is below.</p>
        <p style="margin: 0 0 16px; font-size: 28px; font-weight: 700; letter-spacing: 0.2em;">${code}</p>
        <p style="margin: 0 0 12px;">This code expires in ${config.OTP_EXPIRY_SECONDS} seconds.</p>
        <p style="margin: 0;">If you did not request this code, you can ignore this email.</p>
      </div>
    `,
  });
}

export async function sendOtpMessage(input: SendOtpMessageInput): Promise<SendOtpMessageResult> {
  const config = env();

  if (config.OTP_DEV_MODE && !config.IS_PRODUCTION) {
    return { ok: true, mode: "dev" };
  }

  if (config.OTP_DELIVERY_CHANNEL === "email") {
    if (input.channel !== "EMAIL") {
      return { ok: false, code: "PROVIDER_NOT_CONFIGURED" };
    }

    return sendEmailOtp(input.target, input.code, input.purpose);
  }

  return { ok: false, code: "PROVIDER_NOT_CONFIGURED" };
}

export async function sendTransactionalEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const config = env();

  if (config.OTP_DEV_MODE && !config.IS_PRODUCTION) {
    return { ok: true, mode: "dev" };
  }

  const transport = buildEmailTransport();
  if (!transport || !config.SMTP_FROM) {
    return { ok: false, code: "PROVIDER_NOT_CONFIGURED" };
  }

  try {
    const info = await transport.sendMail({
      from: config.SMTP_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });

    if ((info.accepted?.length ?? 0) === 0 || (info.rejected?.length ?? 0) > 0) {
      console.warn("Transactional email provider rejected delivery", {
        target: maskTarget(input.to),
        acceptedCount: info.accepted?.length ?? 0,
        rejectedCount: info.rejected?.length ?? 0,
        subject: input.subject.slice(0, 120),
      });
      return { ok: false, code: "DELIVERY_FAILED" };
    }

    return { ok: true, mode: "provider" };
  } catch (error) {
    const safeMessage =
      error instanceof Error ? error.message.replace(/(pass(word)?|token|secret)=\S+/gi, "$1=[redacted]") : "unknown";

    console.error("Transactional email delivery failed", {
      target: maskTarget(input.to),
      subject: input.subject.slice(0, 120),
      reason: safeMessage.slice(0, 200),
    });

    return { ok: false, code: "DELIVERY_FAILED" };
  }
}
