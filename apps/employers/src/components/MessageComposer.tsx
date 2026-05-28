import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "./ui/Button";
import { Textarea } from "./ui/Textarea";

// MessageComposer — reply composer for the candidate thread view.
//
// Props:
//   - onSend: called with the body string. Should return a promise that
//             resolves on success. Composer clears + re-enables on success.
//   - disabled: external disable (e.g. when thread is archived).
//
// Brand voice: lowercase placeholder "write a message...".

export interface MessageComposerProps {
  onSend: (body: string) => Promise<void>;
  disabled?: boolean;
}

export function MessageComposer({ onSend, disabled }: MessageComposerProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = !sending && !disabled && value.trim().length > 0;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await onSend(value.trim());
      setValue("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "send failed — please retry.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 border-t border-ink/10 bg-cream rounded-card p-4"
    >
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="write a message..."
        rows={3}
        disabled={sending || disabled}
        aria-label="reply body"
      />
      {error && (
        <p
          role="alert"
          className="text-xs text-tangerine lowercase border border-tangerine/30 bg-tangerine/5 rounded-mark px-3 py-1.5"
        >
          {error}
        </p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink/50 lowercase">
          sends from your agent email — candidates reply to your inbox.
        </span>
        <Button type="submit" variant="primary" disabled={!canSend}>
          {sending ? "sending…" : "send →"}
        </Button>
      </div>
    </form>
  );
}
