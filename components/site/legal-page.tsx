import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { contact } from "@/lib/site";
import { Logo } from "./logo";

// Shared frame for the policy pages: one reading column, a contents list,
// and links between the three policies (was legal_layout.php).

export const LEGAL_UPDATED = "25 October 2026";

const pages = {
  terms: "Terms of service",
  refund: "Refund policy",
  privacy: "Privacy policy",
} as const;

type Props = {
  slug: keyof typeof pages;
  summary: string;
  // Section id -> heading, for the "On this page" list
  sections: Record<string, string>;
  children: ReactNode;
};

export function LegalPage({ slug, summary, sections, children }: Props) {
  return (
    <div className="mx-auto w-full max-w-page px-6">
      <div className="flex items-center justify-between gap-4 py-6">
        <Logo />
        <Link href="/" className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-white">
          <ChevronLeft aria-hidden="true" className="size-4" />
          Back to QuizoTab
        </Link>
      </div>

      <nav aria-label="Policies" className="mb-10 flex flex-wrap gap-2">
        {Object.entries(pages).map(([key, label]) => (
          <Link
            key={key}
            href={`/${key}`}
            aria-current={key === slug ? "page" : undefined}
            className={cn(
              "rounded-full border px-4 py-2 text-sm transition-colors",
              key === slug ? "border-cyan bg-cyan font-semibold text-night" : "border-line text-muted hover:border-white/30 hover:text-text",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="grid items-start gap-x-14 pb-18 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Contents list stays in view while reading on a computer */}
        <aside aria-label="On this page" className="mb-8 lg:sticky lg:top-6 lg:row-span-2 lg:mb-0">
          <p className="mb-3 text-[13px] font-semibold text-muted">On this page</p>
          <ol className="border-l border-line">
            {Object.entries(sections).map(([id, heading]) => (
              <li key={id}>
                <a href={`#${id}`} className="-ml-px block border-l-2 border-transparent py-1.5 pl-3.5 text-sm leading-snug text-muted transition-colors hover:border-magenta hover:text-text">
                  {heading}
                </a>
              </li>
            ))}
          </ol>
        </aside>

        <header className="max-w-[68ch] min-w-0">
          <h1 className="text-[clamp(34px,6vw,52px)] leading-[1.05] font-extrabold tracking-tight text-white">{pages[slug]}</h1>
          <p className="mt-3 text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
          <p className="mt-6 rounded-r-xl border-l-[3px] border-magenta bg-magenta/10 px-5 py-4 leading-relaxed">{summary}</p>
        </header>

        <main className="legal-doc max-w-[68ch] min-w-0">{children}</main>
      </div>

      <footer className="flex flex-wrap justify-between gap-4 border-t border-line py-6 text-sm text-muted">
        <span>© {new Date().getFullYear()} QuizoTab</span>
        <span className="flex flex-wrap gap-5">
          {Object.entries(pages).map(([key, label]) => (
            <Link key={key} href={`/${key}`} className="hover:text-white">
              {label}
            </Link>
          ))}
        </span>
      </footer>
    </div>
  );
}

export function LegalContact() {
  return (
    <ul className="legal-contact">
      <li>
        Email: <a href={`mailto:${contact.email}`}>{contact.email}</a>
      </li>
      {contact.phone && (
        <li>
          Phone{contact.whatsapp ? " and WhatsApp" : ""}: {contact.phone}
        </li>
      )}
      {contact.address && <li>Address: {contact.address}</li>}
    </ul>
  );
}
