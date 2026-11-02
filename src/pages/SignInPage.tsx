import { useState, type FormEvent } from "react";
import { alarmsAvailable, connectBackgroundRefresh } from "../lib/alarms";
import { db } from "../lib/client";

// Email and password sign-in. Accounts are made by invitation (sign-ups are closed in Supabase).
export function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { error } = await db.auth.signInWithPassword({ email, password });
    // A failure here leaves a "!" on the Alarms page, which asks for the password again
    if (!error && alarmsAvailable) void connectBackgroundRefresh(email, password);
    setBusy(false);
    setMessage(error ? error.message : null);
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-3xl border border-white/10 bg-night-panel">
      <form onSubmit={(event) => void submit(event)} className="flex w-72 flex-col gap-3">
        <h1 className="mb-2 text-center text-sm uppercase tracking-[0.3em] text-white/75">Sign in</h1>
        <input type="email" required autoFocus placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} className={field} />
        <input type="password" required placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} className={field} />
        <button type="submit" disabled={busy} className="rounded-lg border border-emerald-300/35 bg-emerald-400/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-emerald-100 hover:bg-emerald-400/25 disabled:opacity-50">
          Sign in
        </button>
        <p className="text-center text-[11px] tracking-[0.12em] text-white/45">No account? Ashborn is invite-only right now.</p>
        {message ? <p className="text-center text-xs leading-relaxed text-white/60">{message}</p> : null}
      </form>
    </section>
  );
}

const field =
  "rounded-lg border border-white/10 bg-night/70 px-3 py-2 text-xs text-white/90 placeholder:text-white/40 focus:border-white/30 focus:outline-none";
