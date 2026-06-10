// Minimal classnames helper — joins truthy strings with a space.
// We deliberately avoid pulling in `clsx` + `tailwind-merge` for this surface:
// the founder portal has a small component count and no class-conflict-prone
// dynamic styling. If composition needs grow (variant systems, conditional
// merges), upgrade to clsx + tailwind-merge in a future plan.
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}
