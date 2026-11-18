// Joins class names, skipping anything empty: cn("a", active && "b") -> "a b" or "a"
export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
