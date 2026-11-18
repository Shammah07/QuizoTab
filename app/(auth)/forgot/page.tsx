import type { Metadata } from "next";
import { ForgotForm } from "@/components/site/auth-forms";
import { FORGOT_LABELS } from "@/components/site/auth-labels";
import { getTranslator, labelsFor } from "@/lib/i18n";

export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPage() {
  const { t } = await getTranslator();
  return (
    <>
      <h1 className="mb-2 text-3xl font-extrabold text-white">{t("Forgot password?")}</h1>
      <p className="mb-6 text-muted">{t("Enter the email you registered with and we'll send you a link to choose a new password.")}</p>
      <ForgotForm labels={labelsFor(t, FORGOT_LABELS)} />
    </>
  );
}
