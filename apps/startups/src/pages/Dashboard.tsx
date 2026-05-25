import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useClerk, useUser } from "@clerk/clerk-react";
import { useApi } from "../lib/api";

// Response shape from the Fly proxy /v1/me endpoint (added in 28.5-03 — the
// route does not yet exist on the Fly side as of 28.5-02, so the dashboard
// gracefully degrades to placeholders when the fetch fails).
interface MeResponse {
  startup_id: string;
  member_id: string;
  startup_name: string;
  agent_email?: string;
  role_count: number;
}

// Dashboard skeleton. 28.5-02 only scaffolds the surface — actual data wiring
// (roles list, thread inbox, candidate cards) lands in 28.5-03.
//
// Behavior:
//   - On mount, calls GET /api/me (which proxies to Fly /v1/me).
//   - If the response is 200 → renders real values.
//   - If the endpoint doesn't exist yet → falls back to placeholders ("your
//     startup", "—", "0"). This is the expected dev/staging state until 28.5-03.
//   - Sign-out via Clerk's useClerk().signOut() — returns user to "/".
export function Dashboard() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const api = useApi();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<MeResponse>("/me");
        if (!cancelled) setMe(data);
      } catch {
        // Expected during 28.5-02 — /v1/me doesn't exist yet on Fly side.
        // No-op; UI falls through to placeholders.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const startupName = me?.startup_name ?? "your startup";
  const agentEmail = me?.agent_email ?? "—";
  const roleCount = me?.role_count ?? 0;
  const founderEmail =
    user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? "";

  return (
    <main className="min-h-screen bg-lavender text-ink">
      <header className="border-b border-ink/10 bg-cream px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-label uppercase tracking-widest text-ink/60">
            internjobs<span className="accent-dot">.</span>ai
          </p>
          <h1 className="text-h2 font-extrabold lowercase">{startupName}</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-ink/60 lowercase hidden sm:inline">
            {founderEmail}
          </span>
          <button
            type="button"
            onClick={() => signOut({ redirectUrl: "/" })}
            className="text-xs lowercase border border-ink/20 px-3 py-1.5 rounded-pill hover:bg-ink hover:text-cream transition"
          >
            sign out
          </button>
        </div>
      </header>

      <section className="px-6 py-8 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <Card label="agent email" value={agentEmail} />
          <Card label="open roles" value={String(roleCount)} />
          <Card label="status" value={loading ? "loading" : "ready"} />
        </div>

        <div className="flex flex-wrap gap-3 mb-10">
          <Link
            to="/roles/new"
            className="bg-ink text-cream px-5 py-2.5 rounded-pill text-sm font-semibold lowercase hover:bg-cobalt transition"
          >
            post a role →
          </Link>
        </div>

        <section className="bg-cream rounded-card p-6">
          <h2 className="text-h3 font-bold lowercase mb-3">recent threads</h2>
          <p className="text-sm text-ink/60 lowercase">
            no threads yet. candidate replies will appear here once you post a
            role.
          </p>
        </section>
      </section>
    </main>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-cream rounded-card p-5 border border-ink/5">
      <p className="text-label uppercase tracking-widest text-ink/50 mb-1.5">
        {label}
      </p>
      <p className="text-h3 font-bold lowercase break-all">{value}</p>
    </div>
  );
}
