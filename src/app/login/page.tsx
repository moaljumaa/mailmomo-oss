"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { authClient } from "@/lib/client/auth";
import { Button, Field, inputCls } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const [setup, setSetup] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetch("/api/setup").then((r) => r.json()).then((d) => setSetup(!!d.needsSetup)).catch(() => setSetup(false)); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    const r = setup
      ? await authClient.signUp.email({ email, password, name: name || email.split("@")[0] })
      : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (r.error) { setError(r.error.message || "Something went wrong"); return; }
    router.push("/mail/inbox");
    router.refresh();
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4">
      <div className="w-full max-w-[360px] anim-fade">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-white shadow-sm"><Mail size={24} /></div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{setup ? "Welcome to Mailmomo" : "Sign in"}</h1>
          <p className="mt-1 text-[13.5px] text-muted">{setup ? "Create the owner account for this server." : "Your calm, fast, AI-native inbox."}</p>
        </div>
        <form onSubmit={submit} className="space-y-3.5 rounded-xl border border-line bg-bg p-5 shadow-sm" data-testid="login-form">
          {setup && <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" data-testid="name" /></Field>}
          <Field label="Email"><input className={inputCls} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus data-testid="email" /></Field>
          <Field label="Password" hint={setup ? "At least 10 characters." : undefined}><input className={inputCls} type="password" required minLength={setup ? 10 : 1} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup ? "new-password" : "current-password"} data-testid="password" /></Field>
          {error && <div role="alert" className="text-[12.5px] text-danger" data-testid="login-error">{error}</div>}
          <Button type="submit" variant="primary" className="w-full" loading={busy || setup === null} data-testid="submit">{setup ? "Create account" : "Sign in"}</Button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
