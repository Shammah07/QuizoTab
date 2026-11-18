import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/site/auth-forms";
import { REGISTER_LABELS } from "@/components/site/auth-labels";
import { getSession } from "@/lib/auth/session";
import { getTranslator, labelsFor } from "@/lib/i18n";

export const metadata: Metadata = { title: "Register" };

export default async function RegisterPage() {
  if (await getSession()) redirect("/");
  const { t } = await getTranslator();

  return (
    <>
      <h1 className="mb-6 text-3xl font-extrabold text-white">{t("Register")}</h1>
      <RegisterForm labels={labelsFor(t, REGISTER_LABELS)} />
    </>
  );
}
