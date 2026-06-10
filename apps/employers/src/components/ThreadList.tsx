import { Link } from "react-router-dom";
import { Card, CardContent } from "./ui/Card";
import type { ThreadSummary } from "../lib/api";

// ThreadList — renders a vertical list of candidate threads. Used on the
// dashboard "recent threads" surface. Each entry links to /thread/:id.
//
// Empty state and loading state are handled here so the parent dashboard
// only has to pass `threads` + `loading`.

export interface ThreadListProps {
  threads: ThreadSummary[];
  loading?: boolean;
  emptyMessage?: string;
}

export function ThreadList({
  threads,
  loading,
  emptyMessage,
}: ThreadListProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-14 rounded-card bg-ink/5 animate-pulse"
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  if (!threads.length) {
    return (
      <p className="text-sm text-ink/60 lowercase">
        {emptyMessage ??
          "no threads yet. candidate replies will appear here once you post a role."}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {threads.map((t) => (
        <li key={t.thread_id}>
          <Link
            to={`/thread/${encodeURIComponent(t.thread_id)}`}
            className="block"
          >
            <Card className="hover:border-cobalt/40 transition">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold lowercase text-ink">
                    {t.candidate_name || "candidate"}
                  </span>
                  <span className="text-xs text-ink/50 lowercase">
                    {formatTime(t.last_message_at)}
                  </span>
                </div>
                {t.unread_count > 0 && (
                  <span className="text-xs font-bold lowercase bg-cobalt text-cream rounded-pill px-3 py-1">
                    {t.unread_count} new
                  </span>
                )}
              </CardContent>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function formatTime(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
