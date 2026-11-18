import { Globe } from "lucide-react";
import type { Lang } from "@/lib/i18n/config";

// Switches the page to the other language. The label is written in the language it switches to.
const other = {
  en: { code: "sw", short: "SW", label: "Badilisha kuwa Kiswahili" },
  sw: { code: "en", short: "EN", label: "Switch to English" },
} as const;

export function LangSwitch({ lang }: { lang: Lang }) {
  const to = other[lang];
  return (
    // A plain link, not next/link: the page has to be fetched again so the server renders the new language
    <a
      href={`?lang=${to.code}`}
      hrefLang={to.code}
      lang={to.code}
      title={to.label}
      aria-label={to.label}
      className="inline-flex h-[42px] items-center gap-1.5 px-2.5 text-[13.5px] font-semibold text-text transition-colors hover:bg-white/10"
    >
      <Globe aria-hidden="true" className="size-[18px]" strokeWidth={1.7} />
      <span>{to.short}</span>
    </a>
  );
}
