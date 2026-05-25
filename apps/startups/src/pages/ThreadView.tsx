import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { MessageComposer } from "../components/MessageComposer";
import { useApiBound } from "../lib/api";
import type { ThreadDetail, ThreadMessage } from "../lib/api";

// ThreadView — full thread message history + reply composer for a single
// candidate conversation.
//
// Flow:
//   1. On mount → fetch /api/threads/:id/messages.
//   2. Render messages list. inbound = left-aligned, outbound = right-
//      aligned (the agent/founder's voice on the right).
//   3. MessageComposer at the bottom. On send:
//      a. POST /api/threads/:id/reply
//      b. Optimistically append the outbound message to the list AND
//         re-fetch to reconcile (the Fly proxy stamps the real id +
//         server-side created_at + delivery status).

export function ThreadView() {
  const { id } = useParams<{ id: string }>();
  const api = useApiBound();
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getThread(id);
      setThread(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!id) return;
        const data = await api.getThread(id);
        if (!cancelled) {
          setThread(data);
          setError(null);
        }
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

  async function handleSend(body: string) {
    if (!id) return;
    // Optimistic append so the UI feels instant. We use a temporary id
    // prefix that the re-fetch will displace.
    const optimistic: ThreadMessage = {
      id: `optimistic-${Date.now()}`,
      direction: "outbound",
      body,
      created_at: new Date().toISOString(),
      channel: "email",
    };
    setThread((prev) =>
      prev
        ? { ...prev, messages: [...prev.messages, optimistic] }
        : prev,
    );
    try {
      await api.sendReply(id, body);
      // Re-fetch to reconcile with the canonical server-side state.
      await load();
    } catch (err) {
      // Remove the optimistic row so the user sees the failure clearly.
      setThread((prev) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.filter((m) => m.id !== optimistic.id),
            }
          : prev,
      );
      throw err; // MessageComposer renders the inline error
    }
  }

  return (
    <main className="min-h-screen bg-lavender text-ink">
      <header className="border-b border-ink/10 bg-cream px-6 py-4 flex items-center justify-between">
        <Link to="/dashboard" className="block">
          <p className="text-label uppercase tracking-widest text-ink/60">
            internjobs<span className="accent-dot">.</span>ai
          </p>
          <h1 className="text-h2 font-extrabold lowercase">
            {thread?.candidate_name || "thread"}
          </h1>
        </Link>
        <Link to="/dashboard">
          <Button variant="ghost">← back</Button>
        </Link>
      </header>

      <section className="px-6 py-8 max-w-3xl mx-auto flex flex-col gap-4">
        {loading && (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-12 rounded-card bg-ink/5 animate-pulse"
                aria-hidden="true"
              />
            ))}
          </div>
        )}

        {!loading && error && (
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-tangerine lowercase">
                couldn't load thread: {error}
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && thread && thread.messages.length === 0 && (
          <p className="text-sm text-ink/60 lowercase">
            no messages yet in this thread.
          </p>
        )}

        {!loading && thread && thread.messages.length > 0 && (
          <ol className="flex flex-col gap-3" aria-label="message history">
            {thread.messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </ol>
        )}

        <MessageComposer onSend={handleSend} disabled={loading || !!error} />
      </section>
    </main>
  );
}

function MessageBubble({ message }: { message: ThreadMessage }) {
  const isOutbound = message.direction === "outbound";
  return (
    <li
      className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}
      data-direction={message.direction}
    >
      <div
        className={`max-w-[80%] rounded-card px-4 py-3 ${
          isOutbound
            ? "bg-cobalt text-cream"
            : "bg-cream text-ink border border-ink/10"
        }`}
      >
        <p className="text-sm whitespace-pre-wrap break-words">
          {message.body}
        </p>
        <p
          className={`text-xs mt-1 lowercase ${
            isOutbound ? "text-cream/70" : "text-ink/50"
          }`}
        >
          {formatTime(message.created_at)} · {message.channel}
        </p>
      </div>
    </li>
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
