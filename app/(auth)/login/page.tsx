import { Suspense } from "react";

import { LoginForm } from "@/features/auth/components/login-form";

export default function LoginPage() {
  return (
    <section>
      <Suspense fallback={<div className="h-[560px] w-full rounded-3xl border border-slate-200 bg-white/80" />}>
        <LoginForm />
      </Suspense>
    </section>
  );
}
