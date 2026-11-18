import { Mail, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Translate } from "@/lib/i18n";
import { contact } from "@/lib/site";
import { Logo } from "./logo";

function ContactLine({ href, icon, small, strong, external }: { href: string; icon: ReactNode; small: string; strong: string; external?: boolean }) {
  return (
    <a href={href} className="group flex items-center gap-3.5" {...(external ? { target: "_blank", rel: "noopener" } : {})}>
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center border border-line text-live transition-colors group-hover:border-live">
        {icon}
      </span>
      <span className="flex flex-col">
        <small className="text-[13px] text-muted">{small}</small>
        <strong className="font-semibold text-text">{strong}</strong>
      </span>
    </a>
  );
}

export function SiteFooter({ t }: { t: Translate }) {
  const columns = [
    {
      title: t("Tournaments"),
      links: [
        { href: "/host", label: t("Host a tournament") },
        { href: "/#steps", label: t("See how it works") },
      ],
    },
    {
      title: t("Live quizzes"),
      links: [
        { href: "/quiz/explore", label: t("Play a quiz") },
        { href: "/quiz", label: t("Create your own quiz") },
      ],
    },
    {
      title: "QuizoTab",
      links: [
        { href: "/privacy", label: t("Privacy") },
        { href: "/terms", label: t("Terms") },
        { href: "/refund", label: t("Refund policy") },
      ],
    },
  ];

  return (
    <footer className="border-t border-line bg-studio-deep pt-16 pb-7">
      <div className="mx-auto grid max-w-page gap-12 px-6 md:grid-cols-[1.2fr_2fr]">
        <div className="flex flex-col gap-5">
          <Logo />
          {contact.whatsapp ? (
            <ContactLine
              href={`https://wa.me/${contact.whatsapp}`}
              external
              icon={<MessageCircle className="size-5" />}
              small={t("Chat with us on WhatsApp")}
              strong={contact.phone || `+${contact.whatsapp}`}
            />
          ) : contact.phone ? (
            <ContactLine href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} icon={<Phone className="size-5" />} small={t("Call us")} strong={contact.phone} />
          ) : null}
          <ContactLine href={`mailto:${contact.email}`} icon={<Mail className="size-5" />} small={t("Write to us")} strong={contact.email} />
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {columns.map((column) => (
            <div key={column.title}>
              <h2 className="mb-4 font-sans text-[15px] font-semibold text-white [font-stretch:100%]">{column.title}</h2>
              <ul className="flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-[15px] text-muted transition-colors hover:text-white">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <p className="mx-auto mt-14 max-w-page border-t border-line px-6 pt-6 text-sm text-muted">
        © {new Date().getFullYear()} QuizoTab, {contact.address}
      </p>
    </footer>
  );
}
