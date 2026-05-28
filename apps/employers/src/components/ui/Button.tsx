import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

// Lightweight Button primitive — shadcn-shaped variant API but
// implemented with plain Tailwind brand tokens.
//
// Variants:
//   - primary  (default): ink-on-cream → hover cobalt — load-bearing CTAs
//   - cobalt   : cobalt-on-cream — secondary CTAs (e.g. "post role →")
//   - outline  : ink-bordered, transparent — tertiary actions
//   - ghost    : transparent + ink/60 — nav / sign-out
//
// Sizes:
//   - sm (default): py-2 px-4 text-sm
//   - lg          : py-3 px-6 text-base
//
// No hex literals; all colors via brand tokens. Lowercase voice
// enforced by callers via children text (not by component).

type Variant = "primary" | "cobalt" | "outline" | "ghost";
type Size = "sm" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-ink text-cream hover:bg-cobalt focus-visible:ring-cobalt disabled:opacity-50 disabled:hover:bg-ink",
  cobalt:
    "bg-cobalt text-cream hover:opacity-90 focus-visible:ring-ink disabled:opacity-50",
  outline:
    "border border-ink/20 text-ink hover:bg-ink hover:text-cream focus-visible:ring-cobalt disabled:opacity-50",
  ghost:
    "text-ink/70 hover:text-ink hover:bg-ink/5 focus-visible:ring-cobalt disabled:opacity-50",
};

const SIZES: Record<Size, string> = {
  sm: "py-2 px-4 text-sm",
  lg: "py-3 px-6 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "sm", type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-pill",
        "font-semibold transition focus-visible:outline-none focus-visible:ring-2",
        "disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
