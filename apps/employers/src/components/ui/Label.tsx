import { forwardRef } from "react";
import type { LabelHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

// Lightweight Label primitive. Lowercase voice; brand tokens only.
export const Label = forwardRef<
  HTMLLabelElement,
  LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      "block text-label uppercase tracking-widest text-ink/60 mb-1.5",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";
