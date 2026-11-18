import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

// Hard-edged, flat buttons. The variant names date from the neon design and are kept so every page still works.
const base =
  "inline-flex items-center justify-center font-semibold whitespace-nowrap cursor-pointer " +
  "transition-[background-color,color,border-color] duration-150 " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

const variants = {
  // The main blue button (was the glowing magenta one)
  neon: "bg-live text-white hover:bg-live-deep",
  // The outlined button
  line: "border-2 border-line text-text hover:border-text hover:bg-white/5",
  ghost: "text-text hover:bg-white/10",
  danger: "bg-bad text-studio hover:brightness-110",
} as const;

const sizes = {
  sm: "h-9 px-4 text-sm",
  md: "h-[50px] px-7 text-base",
  lg: "h-14 px-9 text-lg",
} as const;

type Style = {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export function buttonClass({ variant = "neon", size = "md" }: Style = {}, className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({ variant, size, className, type = "button", ...props }: ComponentProps<"button"> & Style) {
  return <button type={type} className={buttonClass({ variant, size }, className)} {...props} />;
}

// A link that looks like a button. Page links go through next/link; #anchors, mailto: and outside links stay plain.
export function ButtonLink({ variant, size, className, href, ...props }: ComponentProps<"a"> & Style & { href: string }) {
  const classes = buttonClass({ variant, size }, className);
  if (href.startsWith("/")) return <Link href={href} className={classes} {...props} />;
  return <a href={href} className={classes} {...props} />;
}
