"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, startTransition, useEffect, useMemo, useRef, useState } from "react";

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
  const callbackUrl = useMemo(() => getSafeCallbackUrl(searchParams.get("callbackUrl")), [searchParams]);

  const [target, setTarget] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [maskedTarget, setMaskedTarget] = useState<string | null>(null);
  const [devOtpPreview, setDevOtpPreview] = useState<string | null>(null);
  const [resendAfter, setResendAfter] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isPasswordLoggingIn, setIsPasswordLoggingIn] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTargetBlinking, setIsTargetBlinking] = useState(false);
  const otpInputRef = useRef<HTMLInputElement | null>(null);
  const targetInputRef = useRef<HTMLInputElement | null>(null);

  const showVerification = Boolean(maskedTarget);
  const otpDigits = Array.from({ length: 6 }, (_, index) => code[index] ?? "");

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
    if (!target.trim()) {
      setError("Please enter email or phone first.");
      setMessage(null);
      setIsTargetBlinking(true);
      targetInputRef.current?.focus();
      window.setTimeout(() => setIsTargetBlinking(false), 900);
      return;
    }

    setIsSending(true);
    setError(null);
    setMessage("Sending OTP...");

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
      setDevOtpPreview(payload.data.devOtpPreview ?? null);
      setCode("");
      setResendAfter(payload.data.resendAfterSeconds);
      setMessage(payload.message || "Email sent. Check your inbox.");
    } catch {
      setError("Unable to send OTP right now.");
    } finally {
      setIsSending(false);
    }
  }

  async function loginWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPasswordLoggingIn(true);
    setError(null);
    setMessage(null);

    try {
      const result = await signIn("credentials", {
        method: "PASSWORD",
        target,
        password,
        redirect: false,
        callbackUrl,
      });

      if (!result?.ok) {
        setError("Invalid email/phone or password.");
        return;
      }

      setMessage("Signed in.");
      startTransition(() => {
        router.replace(callbackUrl);
      });
    } catch {
      setError("Unable to sign in right now.");
    } finally {
      setIsPasswordLoggingIn(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsVerifying(true);
    setError(null);
    setMessage(null);

    try {
      const result = await signIn("credentials", {
        method: "OTP",
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
      startTransition(() => {
        router.replace(callbackUrl);
      });
    } catch {
      setError("Unable to verify OTP right now.");
    } finally {
      setIsVerifying(false);
    }
  }

  function resetVerification() {
    setMaskedTarget(null);
    setCode("");
    setDevOtpPreview(null);
    setResendAfter(0);
    setMessage(null);
    setError(null);
  }

  return showVerification ? (
    <div className="matrix-login-stack">
      <button type="button" className="matrix-login-back-link matrix-login-back-link--outside" onClick={resetVerification}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M15 18 9 12l6-6" />
        </svg>
        Back to login
      </button>

      <form className="matrix-login-card matrix-login-card--verify" onSubmit={verifyOtp}>
        <div className="matrix-login-lock matrix-login-lock-verify">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M12 3.5 19 6v5c0 4.4-2.8 7.7-7 9.2-4.2-1.5-7-4.8-7-9.2V6l7-2.5Z" />
            <path d="M9.5 12v-1.2A2.5 2.5 0 0 1 12 8.3a2.5 2.5 0 0 1 2.5 2.5V12" />
            <rect x="9" y="11.8" width="6" height="5" rx="1.6" />
            <circle cx="12" cy="14.1" r="0.8" />
          </svg>
        </div>

        <div className="matrix-login-heading matrix-login-heading-verify">
          <h1>Verify OTP</h1>
          <p>
            We have sent a 6-digit code to
            <br />
            <strong>{maskedTarget}</strong>
          </p>
        </div>

        <div className="matrix-login-code-grid" onClick={() => otpInputRef.current?.focus()} role="presentation">
          {otpDigits.map((digit, index) => (
            <div key={index} className={`matrix-login-code-box${index === code.length ? " is-active" : ""}${digit ? " has-digit" : ""}`}>
              {digit}
            </div>
          ))}
          <input
            ref={otpInputRef}
            id="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            className="matrix-login-code-input"
            placeholder="Enter OTP code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            autoComplete="one-time-code"
            aria-label="OTP code"
          />
        </div>

        <div className="matrix-login-resend-count">
          Resend code in <span>{resendAfter > 0 ? `${String(Math.floor(resendAfter / 60)).padStart(2, "0")}:${String(resendAfter % 60).padStart(2, "0")}` : "00:00"}</span>
        </div>

        <button type="submit" disabled={isVerifying || !target.trim() || code.length < 6} className="matrix-login-primary">
          {isVerifying ? "Verifying..." : "Verify OTP"}
        </button>

        <div className="matrix-login-divider">
          <span />
          <em>OR</em>
          <span />
        </div>

        <button type="button" onClick={sendOtp} disabled={isSending || resendAfter > 0} className="matrix-login-secondary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M3 6h18v12H3z" />
            <path d="m4 7 8 6 8-6" />
          </svg>
          {resendAfter > 0 ? `Resend in ${String(Math.floor(resendAfter / 60)).padStart(2, "0")}:${String(resendAfter % 60).padStart(2, "0")}` : "Resend OTP"}
        </button>

        <button type="button" className="matrix-login-change-link" onClick={resetVerification}>
          Change email or phone number
        </button>

        <button type="button" className="matrix-login-change-link" onClick={resetVerification}>
          Use password instead
        </button>

        <div className="matrix-login-feedback">
          {error ? <p className="matrix-login-error">{error}</p> : null}
          {!error && message ? <p className="matrix-login-muted">{message}</p> : null}
          {devOtpPreview ? (
            <div className="matrix-login-dev-otp">
              <span className="matrix-login-dev-otp-icon" aria-hidden="true">
                !
              </span>
              <p>
                Dev OTP preview: <strong>{devOtpPreview}</strong>
              </p>
            </div>
          ) : null}
        </div>
      </form>
    </div>
  ) : (
    <form className="matrix-login-card" onSubmit={loginWithPassword}>
      <div className="matrix-login-lock">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <rect x="5" y="10" width="14" height="10" rx="2.4" />
          <path d="M8 10V7a4 4 0 1 1 8 0v3" />
          <circle cx="12" cy="15" r="1.1" />
        </svg>
      </div>

      <div className="matrix-login-heading">
        <h1>Welcome back</h1>
        <p>Sign in using your password</p>
      </div>

      <div className="matrix-login-field">
        <label htmlFor="target">Email or Phone</label>
        <div className={`matrix-login-input-wrap transition ${isTargetBlinking ? "animate-pulse ring-2 ring-[#315cff]" : ""}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 19a7 7 0 0 1 14 0" />
          </svg>
          <input
            ref={targetInputRef}
            id="target"
            type="text"
            placeholder="Enter your email or phone number"
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
              if (isTargetBlinking) {
                setIsTargetBlinking(false);
              }
            }}
            autoComplete="username"
          />
        </div>
      </div>

      <div className="matrix-login-field">
        <label htmlFor="password">Password</label>
        <div className="matrix-login-input-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="5" y="10" width="14" height="10" rx="2.4" />
            <path d="M8 10V7a4 4 0 1 1 8 0v3" />
          </svg>
          <input
            id="password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div className="mt-2 text-right">
          <button type="button" onClick={sendOtp} disabled={isSending || resendAfter > 0} className="text-sm font-semibold text-[#315cff]">
            {isSending ? "Sending OTP..." : resendAfter > 0 ? `Login with OTP (${resendAfter}s)` : "Login with OTP"}
          </button>
        </div>
      </div>

      <button type="submit" disabled={isPasswordLoggingIn || !target.trim() || !password} className="matrix-login-primary">
        {isPasswordLoggingIn ? "Signing in..." : "Login"}
      </button>

      <p className="matrix-login-terms">
        By continuing, you agree to the platform terms and privacy policy configured for your workspace.
      </p>

      <div className="matrix-login-feedback">
        {error ? <p className="matrix-login-error">{error}</p> : null}
        {!error && message ? <p className="matrix-login-muted">{message}</p> : null}
      </div>
    </form>
  );
}
