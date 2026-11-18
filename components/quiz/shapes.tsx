import { cn } from "@/lib/cn";

// Triangle, diamond, circle, square: each answer has its own colour and its own shape,
// so the four choices can be told apart even by someone who can't see the colours.

export const ANSWER_NAMES = ["Triangle", "Diamond", "Circle", "Square"];

const PATHS = [
  <path key="t" d="M16 4 29 27H3z" />,
  <path key="d" d="M16 3 29 16 16 29 3 16z" />,
  <circle key="c" cx="16" cy="16" r="13" />,
  <rect key="s" x="5" y="5" width="22" height="22" rx="3" />,
];

// Background and text colour for answer tiles and buttons
export const ANSWER_STYLES = ["bg-[#ff3b5c] text-white", "bg-live text-white", "bg-amber text-studio", "bg-good text-studio"];

export function Shape({ index, className }: { index: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-6 shrink-0 fill-current", className)}>
      {PATHS[index]}
    </svg>
  );
}
