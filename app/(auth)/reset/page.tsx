import { CircleX } from "lucide-react";
import type { Metadata } from "next";
import { ResetForm } from "@/components/site/auth-forms";
import { RESET_LABELS } from "@/components/site/auth-labels";
import { ButtonLink } from "@/components/ui/button";
import { findTokenUser, RESET_MINUTES } from "@/lib/auth/accounts";
import { db } from "@/lib/db";
import { getTranslator, labelsFor } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Choose a new password",
  // The address holds a secret token: keep it out of search engines and out of the Referer header
  robots: { index: false },
  referrer: "no-referrer",
};

// Opened from the "Choose a new password" button in the reset email
export default async function ResetPage({ searchParams }: PageProps<"/reset">) {
  const { token } = await searchParams;
  const { t } = await getTranslator();
  const user = typeof token === "string" ? await findTokenUser(db(), token, "reset") : null;

  if (!user || typeof token !== "string") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <CircleX aria-hidden="true" className="size-12 text-bad" />
        <h1 className="text-3xl font-extrabold text-white">{t("Link expired")}</h1>
        <p className="text-muted">{t(`This reset link has expired or was already used. Reset links work once, for ${RESET_MINUTES} minutes.`)}</p>
        <ButtonLink href="/forgot" className="mt-2">
          {t("Send a new link")}
        </ButtonLink>
      </div>
    );
  }

  return (
    <>
      <h1 className="mb-2 text-3xl font-extrabold text-white">{t("New password")}</h1>
      <p className="mb-6 text-muted">
        {t("Choose a new password for")} <strong className="text-text">{user.email}</strong>.
      </p>
      <ResetForm labels={labelsFor(t, RESET_LABELS)} token={token} />
    </>
  );
}
