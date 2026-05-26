"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

type OtpSendResponse =
  | {
      ok: true;
      message: string;
      data: {
        maskedTarget: string;
        expiresInSeconds: number;
        resendAfterSeconds: number;
        devOtpPreview?: string;
      };
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

function getSafeCallbackUrl(callbackUrl: string | null): string {
  if (!callbackUrl || !callbackUrl.startsWith("/") || callbackUrl.startsWith("//")) {
    return "/";
  }

  return callbackUrl;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = useMemo(
    () => getSafeCallbackUrl(searchParams.get("callbackUrl")),
    [searchParams]
  );

  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [maskedTarget, setMaskedTarget] = useState<string | null>(null);
  const [devOtpPreview, setDevOtpPreview] = useState<string | null>(null);
  const [resendAfter, setResendAfter] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
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
    setIsSending(true);
    setError(null);
    setMessage(null);
    setDevOtpPreview(null);

    try {
      const response = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, purpose: "LOGIN" }),
      });

      const payload = (await response.json()) as OtpSendResponse;
      if (!payload.ok) {
        setError(payload.error.message);
        return;
      }

      setMaskedTarget(payload.data.maskedTarget);
      setResendAfter(payload.data.resendAfterSeconds);
      setDevOtpPreview(payload.data.devOtpPreview ?? null);
      setMessage(payload.message);
    } catch {
      setError("Unable to send OTP right now.");
    } finally {
      setIsSending(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsVerifying(true);
    setError(null);
    setMessage(null);

    try {
      const result = await signIn("credentials", {
        target,
        code,
        purpose: "LOGIN",
        redirect: false,
        callbackUrl,
      });

      if (!result?.ok) {
        setError("Invalid or expired OTP.");
        return;
      }

      setMessage("Signed in.");
      router.replace(callbackUrl);
      router.refresh();
    } catch {
      setError("Unable to verify OTP right now.");
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={verifyOtp}>
      <div className="space-y-2">
        <label className="block text-sm font-medium" htmlFor="target">
          Email or phone
        </label>
        <div className="flex gap-2">
          <input
            id="target"
            type="text"
            className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
            placeholder="you@example.com / +910000000000"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            autoComplete="username"
          />
          <button
            type="button"
            onClick={sendOtp}
            disabled={isSending || !target.trim() || resendAfter > 0}
            className="shrink-0 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resendAfter > 0 ? `${resendAfter}s` : isSending ? "Sending" : "Send OTP"}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium" htmlFor="code">
          OTP code
        </label>
        <input
          id="code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
          placeholder="6-digit code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
          autoComplete="one-time-code"
        />
      </div>

      {maskedTarget ? <p className="text-xs text-[var(--muted)]">OTP sent to {maskedTarget}.</p> : null}
      {devOtpPreview ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Development OTP preview: {devOtpPreview}
        </p>
      ) : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <button
        type="submit"
        disabled={isVerifying || !target.trim() || code.length < 4}
        className="w-full rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isVerifying ? "Verifying" : "Verify and sign in"}
      </button>
    </form>
  );
}
