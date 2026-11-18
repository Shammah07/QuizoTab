import Link from "next/link";
import { cn } from "@/lib/cn";

// The wordmark: "Quizo" in white, "Tab" on a blue block, like a channel ident in the corner of a broadcast
export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" aria-label="QuizoTab home" className={cn("wide inline-flex items-stretch font-display text-[26px] leading-none font-extrabold tracking-tight text-white", className)}>
      <span className="py-1">Quizo</span>
      <span className="ml-[3px] bg-live px-2 py-1">Tab</span>
    </Link>
  );
}
