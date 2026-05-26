import { Suspense } from "react";

import { LoginForm } from "@/features/auth/components/login-form";

export default function LoginPage() {
  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-[var(--muted)]">Use your registered email or phone to receive an OTP.</p>
      </header>

      <Suspense fallback={<div className="h-40 rounded-md bg-slate-50" />}>
        <LoginForm />
      </Suspense>
    </section>
  );
}
