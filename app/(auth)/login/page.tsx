import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/site/auth-forms";
import { LOGIN_LABELS } from "@/components/site/auth-labels";
import { Alert } from "@/components/ui/alert";
import { getSession } from "@/lib/auth/session";
import { getTranslator, labelsFor } from "@/lib/i18n";

export const metadata: Metadata = { title: "Login" };

// Messages other pages send people here with: /login?notice=...
const notices = {
  confirmed: ["success", "Email confirmed. You can log in now."],
  "link-expired": ["error", "That confirmation link has expired or was already used. Log in to get a new one."],
  "password-changed": ["success", "Password changed. Log in with your new password."],
  "host-login": ["info", "Please login to host a tournament"],
  "quiz-login": ["info", "Log in to host a live quiz"],
  "judge-login": ["info", "Log in with the judge account the host gave you"],
} as const;

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { notice, next } = await searchParams;
  if (await getSession()) redirect("/");

  const { t } = await getTranslator();
  const shown = typeof notice === "string" && notice in notices ? notices[notice as keyof typeof notices] : null;

  return (
    <>
      <h1 className="mb-6 text-3xl font-extrabold text-white">{t("Login")}</h1>
      {shown && (
        <Alert type={shown[0]} className="mb-5">
          {t(shown[1])}
        </Alert>
      )}
      <LoginForm labels={labelsFor(t, LOGIN_LABELS)} next={typeof next === "string" ? next : "/"} />
    </>
  );
}
