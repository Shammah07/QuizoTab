import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/site/logo";
import { cn } from "@/lib/cn";

// The frame around the quiz pages a host or visitor reads on a normal screen:
// logo, a few links back out, and one column of content
export function QuizFrame({ links, children, width = "max-w-[920px]" }: { links: Array<{ href: string; label: string }>; children: ReactNode; width?: string }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line px-(--edge)">
        <div className="mx-auto flex h-16 max-w-page items-center justify-between gap-4">
          <Logo />
          <nav className="flex flex-wrap items-center justify-end gap-1">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="px-3 py-2 text-[14px] font-medium text-muted transition-colors hover:text-white">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className={cn("mx-auto w-full flex-1 px-6 py-12", width)}>{children}</main>
    </div>
  );
}

// The frame around a player's phone screens: logo, the player's name and score, and one centred column
export function PhoneFrame({ me, children }: { me?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col px-5 pb-8">
      <div className="flex h-16 shrink-0 items-center justify-between gap-4">
        <Logo className="text-[22px]" />
        {me}
      </div>
      <main className="flex flex-1 flex-col justify-center py-6" aria-live="polite">
        {children}
      </main>
    </div>
  );
}

// The name and rolling score in the top corner of a phone
export function MeBadge({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border border-line bg-panel px-3 py-1.5 text-sm">
      <span className="max-w-[12ch] truncate font-medium">{name}</span>
      <strong className="wide font-display text-base font-extrabold text-amber">{children}</strong>
    </div>
  );
}

// Big centred message screens on a phone ("You're in!", "Time's up")
export function Message({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="text-center">
      <p className="text-[clamp(30px,8vw,40px)] leading-tight font-extrabold text-white">{title}</p>
      {text && <p className="mt-3 text-muted">{text}</p>}
      {children}
    </div>
  );
}
