"use client";

import { useState } from "react";
import { useEffect } from "react";

type Props = {
  initialName: string;
  otpTarget: string;
  maskedTarget: string;
};

type OtpSendResponse =
  | {
      ok: true;
      message: string;
      data: {
        resendAfterSeconds: number;
        devOtpPreview?: string;
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

export function ProfileSecurityForm({ initialName, otpTarget, maskedTarget }: Props) {
  const [name, setName] = useState(initialName);
  const [newPassword, setNewPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [resendAfter, setResendAfter] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (resendAfter <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setResendAfter((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendAfter]);

  async function sendOtp() {
    setIsSendingOtp(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: otpTarget, purpose: "PASSWORD_RESET" }),
      });

      const payload = (await response.json()) as OtpSendResponse;
      if (!payload.ok) {
        setError(payload.error.message);
        return;
      }

      setMessage("OTP sent successfully.");
      setResendAfter(payload.data.resendAfterSeconds);
    } catch {
      setError("Unable to send OTP right now.");
    } finally {
      setIsSendingOtp(false);
    }
  }

  async function submitChanges(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          newPassword,
          otpCode,
        }),
      });

      const payload = (await response.json()) as { ok: boolean; message?: string; error?: { message: string } };

      if (!response.ok || !payload.ok) {
        setError(payload.error?.message ?? "Unable to update profile.");
        return;
      }

      setMessage(payload.message ?? "Profile updated.");
      setOtpCode("");
      setNewPassword("");
    } catch {
      setError("Unable to update profile right now.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={submitChanges} className="space-y-5 rounded-2xl border border-[#d8e3f4] bg-white p-6 shadow-[0_10px_30px_rgba(18,48,102,0.05)]">
      <div>
        <h2 className="text-xl font-semibold text-[#12284f]">Profile & Security</h2>
        <p className="mt-1 text-sm text-[#6f84a9]">Profile update ke liye OTP verification required hai.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm font-medium text-[#233e66]">
          Full name
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-10 w-full rounded-xl border border-[#d2def1] bg-[#fcfdff] px-3 text-sm text-[#15305f] focus:border-[#3f64ff] focus:outline-none"
            required
            minLength={2}
            maxLength={120}
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-[#233e66]">
          New password (optional)
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="h-10 w-full rounded-xl border border-[#d2def1] bg-[#fcfdff] px-3 text-sm text-[#15305f] focus:border-[#3f64ff] focus:outline-none"
            minLength={8}
            maxLength={72}
          />
        </label>
      </div>

      <div className="rounded-xl border border-[#e0e8f7] bg-[#f8fbff] p-4">
        <p className="text-sm text-[#36507a]">OTP target: <span className="font-semibold text-[#142d58]">{maskedTarget}</span></p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={sendOtp}
            disabled={isSendingOtp || resendAfter > 0}
            className="rounded-xl border border-[#2f5ef8] bg-[#f4f7ff] px-4 py-2 text-sm font-semibold text-[#2754ef] transition hover:bg-[#ebf0ff] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSendingOtp ? "Sending..." : resendAfter > 0 ? `Retry in ${resendAfter}s` : "Send OTP"}
          </button>

          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={otpCode}
            onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="Enter OTP"
            className="h-10 w-40 rounded-xl border border-[#d2def1] bg-white px-3 text-sm text-[#15305f] focus:border-[#3f64ff] focus:outline-none"
            required
          />
        </div>
      </div>

      {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {!error && message ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}

      <button
        type="submit"
        disabled={isSaving || otpCode.length < 4}
        className="rounded-xl bg-gradient-to-r from-[#2f57f2] to-[#2e65ff] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(47,100,255,0.3)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSaving ? "Saving..." : "Save changes"}
      </button>
    </form>
  );
}
