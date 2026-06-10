import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useClerk, useUser } from "@clerk/clerk-react";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { ThreadList } from "../components/ThreadList";
import { useApiBound } from "../lib/api";
import type { MeResponse, RoleSummary, ThreadSummary } from "../lib/api";

// Dashboard — live founder portal home.
//
// On mount:
//   1. getMe()      → startup_name, agent_email, role_count
//   2. getThreads() → recent candidate threads (inbox preview)
//   3. getRoles()   → open roles list
//
// Each fetch is independent — a failure in one (e.g. 404 because the
// founder isn't linked to a startup yet) does NOT block the others.
//
// agent_email may be null until 28.5-04 ships migration 0013 + slug
// assignment. We render a transparent "agent email pending" hint instead
// of "—" so the founder understands the in-flight state.

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const initial = <T,>(): FetchState<T> => ({
  data: null,
  loading: true,
  error: null,
});

export function Dashboard() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const api = useApiBound();

  const [me, setMe] = useState<FetchState<MeResponse>>(initial<MeResponse>());
  const [threads, setThreads] = useState<FetchState<ThreadSummary[]>>(
    initial<ThreadSummary[]>(),
  );
  const [roles, setRoles] = useState<FetchState<RoleSummary[]>>(
    initial<RoleSummary[]>(),
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await api.getMe();
        if (!cancelled) setMe({ data, loading: false, error: null });
      } catch (err) {
        if (!cancelled) {
          setMe({
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    (async () => {
      try {
        const data = await api.getThreads();
        if (!cancelled) setThreads({ data, loading: false, error: null });
      } catch (err) {
        if (!cancelled) {
          setThreads({
            data: [],
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    (async () => {
      try {
        const data = await api.getRoles();
        if (!cancelled) setRoles({ data, loading: false, error: null });
      } catch (err) {
        if (!cancelled) {
          setRoles({
            data: [],
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api]);

  const startupName = me.data?.startup_name ?? "your startup";
  const agentEmail = me.data?.agent_email ?? null;
  const roleCount = me.data?.role_count ?? roles.data?.length ?? 0;
  const founderEmail =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    "";

  // Hard error: the founder is signed in but not linked to a startup.
  // This is the 404 case from /api/me (no startup_members.clerk_user_id row).
  const notLinked =
    me.error !== null && /not_found|404/i.test(me.error) && !me.loading;

  return (
    <main className="min-h-screen bg-lavender text-ink">
      <header className="border-b border-ink/10 bg-cream px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-label uppercase tracking-widest text-ink/60">
            internjobs<span className="accent-dot">.</span>ai
          </p>
          <h1 className="text-h2 font-extrabold lowercase">
            {me.loading ? (
              <span
                className="inline-block h-8 w-48 bg-ink/10 rounded-mark animate-pulse align-middle"
                aria-hidden="true"
              />
            ) : (
              startupName
            )}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-ink/60 lowercase hidden sm:inline">
            {founderEmail}
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() => signOut({ redirectUrl: "/" })}
          >
            sign out
          </Button>
        </div>
      </header>

      {notLinked ? (
        <NotLinkedNotice />
      ) : (
        <section className="px-6 py-8 max-w-4xl mx-auto flex flex-col gap-8">
          <StatGrid
            agentEmail={agentEmail}
            roleCount={roleCount}
            loading={me.loading}
            statusReady={!me.loading && !me.error}
          />

          <div className="flex flex-wrap gap-3">
            <Link to="/roles/new">
              <Button variant="primary" size="lg">
                post a role →
              </Button>
            </Link>
          </div>

          <section>
            <h2 className="text-h3 font-bold lowercase mb-3">recent threads</h2>
            {threads.error && !threads.loading && (
              <p className="text-xs text-tangerine lowercase mb-2">
                couldn't load threads: {shortenError(threads.error)}
              </p>
            )}
            <ThreadList
              threads={threads.data ?? []}
              loading={threads.loading}
            />
          </section>

          <section>
            <h2 className="text-h3 font-bold lowercase mb-3">open roles</h2>
            {roles.error && !roles.loading && (
              <p className="text-xs text-tangerine lowercase mb-2">
                couldn't load roles: {shortenError(roles.error)}
              </p>
            )}
            <RolesList
              roles={roles.data ?? []}
              loading={roles.loading}
            />
          </section>
        </section>
      )}
    </main>
  );
}

function StatGrid({
  agentEmail,
  roleCount,
  loading,
  statusReady,
}: {
  agentEmail: string | null;
  roleCount: number;
  loading: boolean;
  statusReady: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card>
        <CardContent>
          <p className="text-label uppercase tracking-widest text-ink/50 mb-1.5">
            your agent
          </p>
          {loading ? (
            <div
              className="h-6 w-3/4 bg-ink/10 rounded-mark animate-pulse"
              aria-hidden="true"
            />
          ) : agentEmail ? (
            <p className="text-sm font-bold lowercase break-all text-ink">
              {agentEmail}
            </p>
          ) : (
            <p className="text-sm text-ink/60 lowercase italic">
              agent email pending — ridhi will provision shortly.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <p className="text-label uppercase tracking-widest text-ink/50 mb-1.5">
            open roles
          </p>
          {loading ? (
            <div
              className="h-6 w-12 bg-ink/10 rounded-mark animate-pulse"
              aria-hidden="true"
            />
          ) : (
            <p className="text-h3 font-bold lowercase">{roleCount}</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <p className="text-label uppercase tracking-widest text-ink/50 mb-1.5">
            status
          </p>
          {loading ? (
            <div
              className="h-6 w-16 bg-ink/10 rounded-mark animate-pulse"
              aria-hidden="true"
            />
          ) : (
            <p className="text-h3 font-bold lowercase">
              {statusReady ? "ready" : "syncing"}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RolesList({
  roles,
  loading,
}: {
  roles: RoleSummary[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-16 rounded-card bg-ink/5 animate-pulse"
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }
  if (!roles.length) {
    return (
      <p className="text-sm text-ink/60 lowercase">
        no roles yet. post your first role to start matching candidates.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {roles.map((r) => (
        <li key={r.id}>
          <Link to={`/roles/${encodeURIComponent(r.id)}`}>
            <Card className="hover:border-cobalt/40 transition">
              <CardContent className="p-4">
                <p className="text-sm font-semibold lowercase text-ink">
                  {r.title}
                </p>
                {r.location && (
                  <p className="text-xs text-ink/50 lowercase mt-0.5">
                    {r.location}
                  </p>
                )}
              </CardContent>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NotLinkedNotice() {
  return (
    <section className="px-6 py-12 max-w-2xl mx-auto">
      <Card>
        <CardContent className="p-8 flex flex-col gap-3">
          <h2 className="text-h2 font-extrabold lowercase">
            account not linked
          </h2>
          <p className="text-sm text-ink/70 lowercase">
            your account isn't linked to a startup yet. contact{" "}
            <a
              href="mailto:hello@internjobs.ai"
              className="underline decoration-cobalt underline-offset-4"
            >
              hello@internjobs.ai
            </a>{" "}
            and ridhi will get you set up.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

function shortenError(err: string): string {
  // Keep error UI short — strip stack-trace-ish detail.
  if (!err) return "unknown error";
  return err.length > 120 ? `${err.slice(0, 117)}...` : err;
}
