import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

const OTP_HASH_CONTEXT = "matrixcrm:otp:v1";

type OtpHashInput = {
  secret: string;
  target: string;
  purpose: string;
  code: string;
};

export function generateNumericOtp(length: number): string {
  const digits: string[] = [];

  for (let index = 0; index < length; index += 1) {
    digits.push(String(randomInt(0, 10)));
  }

  return digits.join("");
}

export function createOtpHash(input: OtpHashInput): string {
  return createHmac("sha256", input.secret)
    .update(`${OTP_HASH_CONTEXT}:${input.target}:${input.purpose}:${input.code}`)
    .digest("hex");
}

export function timingSafeHashCompare(leftHash: string, rightHash: string): boolean {
  try {
    const left = Buffer.from(leftHash, "hex");
    const right = Buffer.from(rightHash, "hex");

    if (left.length !== right.length) {
      return false;
    }

    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}
