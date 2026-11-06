import { createClient, type OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { useEffect, useState, type FormEvent } from "react";

// The connector's consent page. Supabase's OAuth server sends the user here with an
// `authorization_id` when an agent (Claude's connector) asks for access: the user signs in, sees
// who is asking and where the answer goes, and approves or denies. Supabase then sends the browser
// back to the agent, with a code or an error. Its session lives in memory only: the page's origin is
// shared with every other GitHub Pages site of the account, which could read a stored one.

const db = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const authorizationId = new URLSearchParams(window.location.search).get("authorization_id");
// Shown inside another site's frame, the page could be overlaid to trick an Allow
const framed = window.top !== window.self;
// Where Claude's connector receives its answer; any other host is named as not Claude's
const CLAUDE_HOSTS = ["claude.ai", "claude.com"];

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
    if (framed) return setState({ step: "failed", message: "Open this page in a tab of its own." });
    if (!authorizationId) return setState({ step: "failed", message: "Open this page from the agent's sign-in, not directly." });
    const { data: session } = await db.auth.getSession();
    if (!session.session) return setState({ step: "signIn" });
    const { data, error } = await db.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error) return setState({ step: "failed", message: error.message });
    if ("redirect_url" in data) return leave(data.redirect_url);
    if (!hostOf(data.redirect_uri)) return setState({ step: "failed", message: "The agent's return address isn't a web address." });
    setState({ step: "ask", details: data });
  };

  // Back to the agent, over https only
  const leave = (url: string) => {
    if (!hostOf(url)) return setState({ step: "failed", message: "The agent's return address isn't a secure web address." });
    setState({ step: "leaving" });
    window.location.assign(url);
  };
  useEffect(() => {
    void load();
  }, []);

  const decide = async (allow: boolean) => {
    setState({ step: "leaving" });
    const { data, error } = allow ? await db.auth.oauth.approveAuthorization(authorizationId!) : await db.auth.oauth.denyAuthorization(authorizationId!);
    if (error) return setState({ step: "failed", message: error.message });
    leave(data.redirect_url);
  };

  const signOut = async () => {
    await db.auth.signOut();
    setState({ step: "signIn" });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4 text-ink">
      <section className="w-full max-w-sm panel-lift rounded-2xl border border-ink/8 bg-panel p-6">
        <h1 className="caps mb-5 text-center font-display text-sm font-bold text-ink/90">Ashborn</h1>
        {state.step === "loading" || state.step === "leaving" ? <p className="text-center text-[13px] text-muted">One moment…</p> : null}
        {state.step === "signIn" ? <SignIn onSignedIn={() => void load()} /> : null}
        {state.step === "failed" ? <p className="text-center text-[13px] leading-relaxed text-red-300">{state.message}</p> : null}
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
      <p className="mb-1 text-center text-[13px] leading-relaxed text-ink/60">Sign in to let an agent use your Ashborn.</p>
      <input type="email" required autoFocus placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} className={field} />
      <input type="password" required placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} className={field} />
      <button type="submit" disabled={busy} className={allowButton}>
        Sign in
      </button>
      {message ? <p className="text-center text-[12px] leading-relaxed text-red-300">{message}</p> : null}
    </form>
  );
}

// The host of an https address; null for anything else
function hostOf(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.host : null;
  } catch {
    return null;
  }
}

// The redirect's host is shown whole because it is where the access goes: a client can name itself
// anything (any caller can register one), but not change where Supabase sends the code
function Ask({ details, onDecide, onSignOut }: { details: OAuthAuthorizationDetails; onDecide: (allow: boolean) => void; onSignOut: () => void }) {
  const host = hostOf(details.redirect_uri)!;
  const claude = CLAUDE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
  return (
    <div className="flex flex-col gap-4 text-[13px] leading-relaxed text-ink/70">
      <p className="text-center text-sm text-ink/90">
        An agent calling itself <span className="font-semibold">{details.client.name || "nothing"}</span> wants to use Ashborn as you.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-xl bg-ink/[0.03] p-3">
        <dt className="text-muted">Signed in as</dt>
        <dd className="break-all">{details.user.email}</dd>
        <dt className="text-muted">Answer goes to</dt>
        <dd className="break-all font-medium text-ink/90">{host}</dd>
      </dl>
      {claude ? null : <p className="text-red-300">That is not Claude's address. Allow only if you started this from an agent you trust.</p>}
      <p className="text-muted">It can read and change everything in Ashborn, including deleting. You can sign it out from the connector's settings in the agent.</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => onDecide(false)} className="flex-1 rounded-lg border border-ink/12 px-3 py-2 text-ink/75 hover:bg-ink/6">
          Deny
        </button>
        <button type="button" onClick={() => onDecide(true)} className={`flex-1 ${allowButton}`}>
          Allow
        </button>
      </div>
      <button type="button" onClick={onSignOut} className="text-center text-[11.5px] text-muted hover:text-ink/75">
        Not you? Sign out
      </button>
    </div>
  );
}

const field =
  "rounded-lg border border-ink/10 bg-canvas/60 px-3 py-2 text-[13px] text-ink/90 placeholder:text-ink/35 focus:border-ember/60 focus:outline-none";
const allowButton =
  "rounded-lg bg-ember px-3 py-2 text-[13px] font-medium text-canvas hover:brightness-110 disabled:opacity-50";
