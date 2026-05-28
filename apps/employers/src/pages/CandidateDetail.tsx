import { Link, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";

// CandidateDetail — placeholder page for v1.4. The Fly proxy doesn't
// expose a per-candidate GET endpoint yet (search returns summaries only).
// Full candidate profile UI is a v1.5 task. For now we render the id +
// a back-to-dashboard link so the route doesn't 404.

export function CandidateDetail() {
  const { id } = useParams<{ id: string }>();

  return (
    <main className="min-h-screen bg-lavender text-ink">
      <header className="border-b border-ink/10 bg-cream px-6 py-4 flex items-center justify-between">
        <Link to="/dashboard" className="block">
          <p className="text-label uppercase tracking-widest text-ink/60">
            internjobs<span className="accent-dot">.</span>ai
          </p>
          <h1 className="text-h2 font-extrabold lowercase">candidate</h1>
        </Link>
        <Link to="/dashboard">
          <Button variant="ghost">← back</Button>
        </Link>
      </header>

      <section className="px-6 py-8 max-w-3xl mx-auto">
        <Card>
          <CardContent className="p-6 flex flex-col gap-3">
            <p className="text-label uppercase tracking-widest text-ink/50">
              candidate id
            </p>
            <p className="text-sm font-mono text-ink break-all">{id}</p>
            <p className="text-sm text-ink/70 lowercase">
              candidate profile UI ships in v1.5. for now, use the thread
              view to read messages and reply.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
