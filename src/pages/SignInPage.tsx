import { useState, type FormEvent } from "react";
import { db } from "../lib/client";

// Email and password sign-in, with a mode for creating an account (which must confirm its email
// once before signing in)
export function SignInPage() {
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<{ error: { message: string } | null }>, success?: string) => {
    setBusy(true);
    const { error } = await action();
    setBusy(false);
    setMessage(error ? error.message : (success ?? null));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (creating) void run(() => db.auth.signUp({ email, password }), "Check your email to confirm the account, then sign in.");
    else void run(() => db.auth.signInWithPassword({ email, password }));
  };

  const switchMode = () => {
    setCreating((current) => !current);
    setMessage(null);
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-3xl border border-white/10 bg-night-panel">
      <form onSubmit={submit} className="flex w-72 flex-col gap-3">
        <h1 className="mb-2 text-center text-sm uppercase tracking-[0.3em] text-white/75">{creating ? "Create account" : "Sign in"}</h1>
        <input type="email" required autoFocus placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} className={field} />
        <input
          type="password"
          required
          minLength={creating ? 6 : undefined}
          placeholder={creating ? "Password (at least 6 characters)" : "Password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={field}
        />
        <button type="submit" disabled={busy} className="rounded-lg border border-emerald-300/35 bg-emerald-400/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-emerald-100 hover:bg-emerald-400/25 disabled:opacity-50">
          {creating ? "Create account" : "Sign in"}
        </button>
        <button type="button" onClick={switchMode} className="text-[11px] tracking-[0.12em] text-white/45 hover:text-white/80">
          {creating ? "Have an account? Sign in instead" : "Create an account instead"}
        </button>
        {message ? <p className="text-center text-xs leading-relaxed text-white/60">{message}</p> : null}
      </form>
    </section>
  );
}

const field =
  "rounded-lg border border-white/10 bg-night/70 px-3 py-2 text-xs text-white/90 placeholder:text-white/40 focus:border-white/30 focus:outline-none";
