import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

// Lightweight Input primitive.
//
// Styling: cream-on-ink-border, focus ring uses cobalt accent token.
// No hex literals — brand tokens only.
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type ?? "text"}
    className={cn(
      "w-full bg-cream text-ink placeholder:text-ink/40",
      "border border-ink/15 rounded-mark px-3 py-2 text-sm",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:border-cobalt",
      "disabled:opacity-60 disabled:cursor-not-allowed",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
