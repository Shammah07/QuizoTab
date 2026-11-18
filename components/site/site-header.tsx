import { LogOut } from "lucide-react";
import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import type { Session } from "@/lib/auth/session";
import { ButtonLink } from "@/components/ui/button";
import type { Lang } from "@/lib/i18n/config";
import type { Translate } from "@/lib/i18n";
import { LangSwitch } from "./lang-switch";
import { Logo } from "./logo";

// The top bar: logo, the main links, language switch and the two buttons. It stays put while the page scrolls.
// The Features, Tournaments and Play drop-down menus from the PHP site arrive in phase 2.
export function SiteHeader({ lang, t, session }: { lang: Lang; t: Translate; session: Session | null }) {
  const linkClass = "px-3 py-2 text-[15px] font-medium text-muted transition-colors hover:text-white";

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-studio/95 px-(--edge) backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-4">
        <Logo />

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          <a href="#steps" className={linkClass}>
            {t("Features")}
          </a>
          <Link href="/host" className={linkClass}>
            {t("Tournaments")}
          </Link>
          <Link href="/quiz/explore" className={linkClass}>
            {t("Live quizzes")}
          </Link>
          <Link href="/play" className={linkClass}>
            {t("Join")}
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <LangSwitch lang={lang} />
          {session ? (
            <form action={logoutAction} className="flex items-center gap-2">
              <span className="hidden max-w-[14ch] truncate text-sm font-medium text-text lg:block">{session.name}</span>
              <button type="submit" title={t("Logout")} aria-label={t("Logout")} className="grid size-[42px] cursor-pointer place-items-center border-2 border-line text-text transition-colors hover:border-text hover:bg-white/5">
                <LogOut aria-hidden="true" className="size-[18px]" />
              </button>
            </form>
          ) : (
            <ButtonLink href="/login" variant="line" size="sm" className="h-[42px] px-5">
              {t("Login")}
            </ButtonLink>
          )}
          {/* Hidden on phones, where the hero's own button does the same job */}
          <span className="hidden sm:block">
            <ButtonLink href="/host" size="sm" className="h-[42px] px-5">
              {t("Host a tournament")}
            </ButtonLink>
          </span>
        </div>
      </div>
    </header>
  );
}
