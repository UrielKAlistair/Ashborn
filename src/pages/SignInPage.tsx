import { useState, type FormEvent } from "react";
import { HexMark } from "../components/HexTile";
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
    <section className="panel-lift rounded-2xl border border-white/8 bg-night-panel flex min-h-0 min-w-0 flex-1 items-center justify-center">
      <form onSubmit={(event) => void submit(event)} className="flex w-72 flex-col gap-3">
        <HexMark className="mx-auto h-12 w-14 text-ember/60" />
        <h1 className="mb-2 text-center font-display text-lg font-semibold text-white/90">Sign in</h1>
        <input type="email" required autoFocus placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} className={field} />
        <input type="password" required placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} className={field} />
        <button type="submit" disabled={busy} className="rounded-lg bg-ember px-3 py-2 text-[13px] font-medium text-night hover:brightness-110 disabled:opacity-50 max-sm:min-h-11">
          Sign in
        </button>
        <p className="text-center text-[11.5px] text-white/45">No account? Ashborn is invite-only right now.</p>
        {message ? <p className="text-center text-[12px] leading-relaxed text-red-300">{message}</p> : null}
      </form>
    </section>
  );
}

const field =
  "rounded-lg border border-white/10 bg-night/60 px-3 py-2 text-[13px] text-white/90 placeholder:text-white/35 focus:border-ember/60 focus:outline-none max-sm:min-h-11";
