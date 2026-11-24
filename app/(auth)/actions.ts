"use server";

import { redirect } from "next/navigation";
import { checkLogin, newResetToken, newVerificationToken, normalizeEmail, registerUser, resetPassword } from "@/lib/auth/accounts";
import { createSession, destroySession } from "@/lib/auth/session";
import { db,transactionDb } from "@/lib/db";
import { stagingEnabled } from "@/lib/staging";
import { getTranslator } from "@/lib/i18n";
import { sendResetEmail, sendVerificationEmail } from "@/lib/mail";
import { recordAttempt, tooManyAttempts, visitorIp } from "@/lib/rate-limit";

// What a form shows after it was sent: a message, which field it belongs to, and what was typed
// (so the visitor doesn't have to type everything again). Passwords are never sent back.
export type FormState = {
  type?: "error" | "success";
  message?: string;
  field?: string;
  values?: Record<string, string>;
  // Set after a login with the right password but an unconfirmed email: shows "Send it again"
  unverifiedEmail?: string;
};

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

// Only addresses on this site, so a login link can't be used to bounce people to another website
function safeNext(next: string) {
  return next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}

export async function registerAction(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getTranslator();
  const values = { name: text(form, "name"), email: text(form, "email") };

  const ip = await visitorIp();
  if (await tooManyAttempts(db(), `register:${ip}`, 10, 3600)) {
    return { type: "error", message: t("Too many new accounts from this connection. Try again in an hour."), values };
  }

  const result = await registerUser(db(), { ...values, password: text(form, "password") });
  if (!result.ok) return { type: "error", message: t(result.error), field: result.field, values };
  await recordAttempt(db(), `register:${ip}`);

  // The account is ready to use at once: no confirmation email, straight in
  await createSession({ userId: result.user.id, name: result.user.name, role: result.user.role });
  redirect("/");
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getTranslator();
  const email = text(form, "email");
  const values = { email };

  // At most 10 wrong passwords per visitor and email every 10 minutes
  const key = `login:${await visitorIp()}:${normalizeEmail(email).slice(0, 255)}`;
  if (await tooManyAttempts(db(), key, 10, 600)) {
    return { type: "error", message: t("Too many wrong passwords. Wait a few minutes and try again."), values };
  }

  const result = await checkLogin(db(), email, text(form, "password"));
  if (result.status === "invalid") {
    await recordAttempt(db(), key);
    return { type: "error", message: t("Incorrect email or password!"), values };
  }
  if (result.status === "unverified") {
    return { type: "error", message: t("Confirm your email first. We sent you a link when you registered."), values, unverifiedEmail: result.email };
  }

  await createSession({ userId: result.user.id, name: result.user.name, role: result.user.role });
  redirect(safeNext(text(form, "next")));
}

export async function resendAction(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getTranslator();
  const result = await newVerificationToken(db(), text(form, "email"));

  if (result.status === "too_many") {
    return { type: "error", message: t("We've sent several emails already. Check your spam folder or try again in an hour."), unverifiedEmail: result.email };
  }
  if (result.status === "sent" && !(await sendVerificationEmail(result.user, result.token))) {
    return { type: "error", message: t("The confirmation email couldn't be sent. Try again in a few minutes."), unverifiedEmail: result.user.email };
  }
  // Same answer whether or not the address has an unconfirmed account
  return { type: "success", message: t("If that account still needs confirming, a new link is on its way.") };
}

export async function forgotAction(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getTranslator();
  const email = text(form, "email").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { type: "error", message: t("Enter the email you registered with."), field: "email", values: { email } };
  }

  const ip = await visitorIp();
  if (!(await tooManyAttempts(db(), `forgot:${ip}`, 10, 3600))) {
    await recordAttempt(db(), `forgot:${ip}`);
    const reset = await newResetToken(db(), email);
    if (reset) await sendResetEmail(reset.user, reset.token);
  }
  // The page says the same thing whether or not the account exists, so it can't be used to look up emails
  return { type: "success", values: { email } };
}

export async function resetAction(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getTranslator();
  const args = [text(form,"token"),text(form,"password"),text(form,"confirm")] as const;
  const result = stagingEnabled() ? await transactionDb().transaction(tx=>resetPassword(tx,...args)) : await resetPassword(db(),...args);

  if (result.ok) redirect("/login?notice=password-changed");
  if (result.reason === "expired") redirect("/reset");
  return { type: "error", message: t(result.error), field: result.field };
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}
