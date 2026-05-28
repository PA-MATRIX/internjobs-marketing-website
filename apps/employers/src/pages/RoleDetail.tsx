import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { useApiBound } from "../lib/api";
import type { RoleSummary } from "../lib/api";

// RoleDetail — minimal v1.4 implementation. Fetches the full roles list
// and finds the matching id (the Fly proxy doesn't expose a per-role GET
// endpoint yet; structured search returns the full row). Editing is out
// of scope for v1.4 — that's a v1.5 polish task.

export function RoleDetail() {
  const { id } = useParams<{ id: string }>();
  const api = useApiBound();
  const [role, setRole] = useState<RoleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const roles = await api.getRoles();
        if (cancelled) return;
        const found = roles.find((r) => r.id === id);
        setRole(found ?? null);
        if (!found) setError("role not found");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  return (
    <main className="min-h-screen bg-lavender text-ink">
      <header className="border-b border-ink/10 bg-cream px-6 py-4 flex items-center justify-between">
        <Link to="/dashboard" className="block">
          <p className="text-label uppercase tracking-widest text-ink/60">
            internjobs<span className="accent-dot">.</span>ai
          </p>
          <h1 className="text-h2 font-extrabold lowercase">role detail</h1>
        </Link>
        <Link to="/dashboard">
          <Button variant="ghost">← back</Button>
        </Link>
      </header>

      <section className="px-6 py-8 max-w-3xl mx-auto">
        {loading && (
          <div
            className="h-32 rounded-card bg-ink/5 animate-pulse"
            aria-hidden="true"
          />
        )}
        {!loading && error && (
          <p className="text-sm text-tangerine lowercase">{error}</p>
        )}
        {!loading && role && (
          <Card>
            <CardContent className="p-6 flex flex-col gap-4">
              <div>
                <h2 className="text-h2 font-extrabold lowercase">
                  {role.title}
                </h2>
                {role.location && (
                  <p className="text-sm text-ink/60 lowercase mt-1">
                    {role.location}
                  </p>
                )}
              </div>
              <div>
                <p className="text-label uppercase tracking-widest text-ink/50 mb-2">
                  description
                </p>
                <p className="text-sm text-ink whitespace-pre-wrap">
                  {role.description}
                </p>
              </div>
              {role.comp_range && (
                <div>
                  <p className="text-label uppercase tracking-widest text-ink/50 mb-1">
                    comp range
                  </p>
                  <p className="text-sm text-ink lowercase">
                    {role.comp_range}
                  </p>
                </div>
              )}
              <p className="text-xs text-ink/50 lowercase">
                editing arrives in v1.5. for now, post a new role and your
                agent will use the most recent one.
              </p>
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}
