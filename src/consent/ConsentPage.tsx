import { createClient, type OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { useEffect, useState, type FormEvent } from "react";

// The connector's consent page. Supabase's OAuth server sends the user here with an
// `authorization_id` when an agent (Claude's connector) asks for access: the user signs in, sees
// who is asking and where the answer goes, and approves or denies. Supabase then sends the browser
// back to the agent, with a code or an error. Its own session, kept by this page's origin.

const db = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const authorizationId = new URLSearchParams(window.location.search).get("authorization_id");

type State =
  | { step: "loading" }
  | { step: "signIn" }
  | { step: "ask"; details: OAuthAuthorizationDetails }
  | { step: "leaving" }
  | { step: "failed"; message: string };

export function ConsentPage() {
  const [state, setState] = useState<State>({ step: "loading" });

  // Signed in: who is asking, or, if this user already allowed it, straight back to the agent
  const load = async () => {
    if (!authorizationId) return setState({ step: "failed", message: "Open this page from the agent's sign-in, not directly." });
    const { data: session } = await db.auth.getSession();
    if (!session.session) return setState({ step: "signIn" });
    const { data, error } = await db.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error) return setState({ step: "failed", message: error.message });
    if ("redirect_url" in data) {
      setState({ step: "leaving" });
      return window.location.assign(data.redirect_url);
    }
    setState({ step: "ask", details: data });
  };
  useEffect(() => {
    void load();
  }, []);

  const decide = async (allow: boolean) => {
    setState({ step: "leaving" });
    const { data, error } = allow ? await db.auth.oauth.approveAuthorization(authorizationId!) : await db.auth.oauth.denyAuthorization(authorizationId!);
    if (error) return setState({ step: "failed", message: error.message });
    window.location.assign(data.redirect_url);
  };

  const signOut = async () => {
    await db.auth.signOut();
    setState({ step: "signIn" });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-night p-4 text-white">
      <section className="w-full max-w-sm rounded-3xl border border-white/10 bg-night-panel p-6">
        <h1 className="mb-5 text-center text-sm uppercase tracking-[0.3em] text-white/75">Ashborn</h1>
        {state.step === "loading" || state.step === "leaving" ? <p className="text-center text-xs text-white/55">One moment…</p> : null}
        {state.step === "signIn" ? <SignIn onSignedIn={() => void load()} /> : null}
        {state.step === "failed" ? <p className="text-center text-xs leading-relaxed text-red-200/80">{state.message}</p> : null}
        {state.step === "ask" ? <Ask details={state.details} onDecide={(allow) => void decide(allow)} onSignOut={() => void signOut()} /> : null}
      </section>
    </main>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { error } = await db.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setMessage(error.message);
    onSignedIn();
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <p className="mb-1 text-center text-xs leading-relaxed text-white/60">Sign in to let an agent use your Ashborn.</p>
      <input type="email" required autoFocus placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} className={field} />
      <input type="password" required placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} className={field} />
      <button type="submit" disabled={busy} className={allowButton}>
        Sign in
      </button>
      {message ? <p className="text-center text-xs leading-relaxed text-white/60">{message}</p> : null}
    </form>
  );
}

// The redirect's host is shown because it is where the access goes: a client can name itself
// anything, but not change where Supabase sends the code
function Ask({ details, onDecide, onSignOut }: { details: OAuthAuthorizationDetails; onDecide: (allow: boolean) => void; onSignOut: () => void }) {
  return (
    <div className="flex flex-col gap-4 text-xs leading-relaxed text-white/70">
      <p className="text-center text-sm text-white/90">
        <span className="font-semibold">{details.client.name || "An agent"}</span> wants to use Ashborn as you.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-xl border border-white/10 bg-night/60 p-3">
        <dt className="text-white/45">Signed in as</dt>
        <dd className="truncate">{details.user.email}</dd>
        <dt className="text-white/45">Answer goes to</dt>
        <dd className="truncate">{new URL(details.redirect_uri).host}</dd>
      </dl>
      <p className="text-white/55">It can read and change everything in Ashborn, including deleting. You can sign it out from the connector's settings in the agent.</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => onDecide(false)} className="flex-1 rounded-lg border border-white/15 px-3 py-2 uppercase tracking-[0.18em] text-white/70 hover:border-white/30 hover:text-white">
          Deny
        </button>
        <button type="button" onClick={() => onDecide(true)} className={`flex-1 ${allowButton}`}>
          Allow
        </button>
      </div>
      <button type="button" onClick={onSignOut} className="text-center text-[11px] text-white/40 hover:text-white/70">
        Not you? Sign out
      </button>
    </div>
  );
}

const field =
  "rounded-lg border border-white/10 bg-night/70 px-3 py-2 text-xs text-white/90 placeholder:text-white/40 focus:border-white/30 focus:outline-none";
const allowButton =
  "rounded-lg border border-emerald-300/35 bg-emerald-400/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-emerald-100 hover:bg-emerald-400/25 disabled:opacity-50";
