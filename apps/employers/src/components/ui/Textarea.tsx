import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

// Lightweight Textarea primitive.
//
// Styling matches Input but with min-height-friendly defaults. Brand
// tokens only — no hex literals.
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={rows ?? 4}
    className={cn(
      "w-full bg-cream text-ink placeholder:text-ink/40",
      "border border-ink/15 rounded-mark px-3 py-2 text-sm",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:border-cobalt",
      "disabled:opacity-60 disabled:cursor-not-allowed",
      "resize-y",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
