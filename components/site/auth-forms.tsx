"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { forgotAction, loginAction, registerAction, resendAction, resetAction } from "@/app/(auth)/actions";
import { Alert } from "@/components/ui/alert";
import { AuthForm } from "./auth-form";

// The four account forms. Each page translates the words it needs on the server and passes them in
// as `labels` (English -> the visitor's language); l("Email") looks one up.
type Labels = Record<string, string>;
const reader = (labels: Labels) => (english: string) => labels[english] ?? english;

const linkClass = "font-semibold text-cyan hover:underline";

export function LoginForm({ labels, next }: { labels: Labels; next: string }) {
  const l = reader(labels);
  return (
    <AuthForm
      action={loginAction}
      submit={l("Login")}
      hidden={{ next }}
      fields={[
        { name: "email", label: l("Email"), type: "email", autoComplete: "email" },
        { name: "password", label: l("Password"), type: "password", autoComplete: "current-password" },
      ]}
      after={(state) => (
        <>
          {state.unverifiedEmail && <ResendBox email={state.unverifiedEmail} labels={labels} />}
          <p className="mt-6 text-center text-sm text-muted">
            {l("Don't have an account?")}{" "}
            <Link href="/register" className={linkClass}>
              {l("Register")}
            </Link>
          </p>
        </>
      )}
    >
      <Link href="/forgot" className="self-end text-sm text-muted hover:text-white">
        {l("Forgot password?")}
      </Link>
    </AuthForm>
  );
}

// Appears after a login with the right password but an unconfirmed email
function ResendBox({ email, labels }: { email: string; labels: Labels }) {
  const l = reader(labels);
  const [state, action, pending] = useActionState(resendAction, {});
  return (
    <form action={action} className="mt-5 rounded-xl border border-line bg-white/5 p-4 text-sm text-muted">
      <input type="hidden" name="email" value={email} />
      {state.message && (
        <Alert type={state.type ?? "error"} className="mb-3">
          {state.message}
        </Alert>
      )}
      {l("Didn't get the email?")}{" "}
      <button type="submit" disabled={pending} className={`cursor-pointer ${linkClass}`}>
        {l("Send it again")}
      </button>
    </form>
  );
}

export function RegisterForm({ labels }: { labels: Labels }) {
  const l = reader(labels);
  return (
    <AuthForm
      action={registerAction}
      submit={l("Register")}
      fields={[
        { name: "name", label: l("Name"), type: "text", autoComplete: "name", maxLength: 100 },
        { name: "email", label: l("Email"), type: "email", autoComplete: "email" },
        { name: "password", label: l("Password"), type: "password", autoComplete: "new-password", minLength: 8, hint: l("8 characters or more") },
      ]}
      after={() => (
        <p className="mt-6 text-center text-sm text-muted">
          {l("Already have an account?")}{" "}
          <Link href="/login" className={linkClass}>
            {l("Login")}
          </Link>
        </p>
      )}
    />
  );
}

export function ForgotForm({ labels }: { labels: Labels }) {
  const l = reader(labels);
  return (
    <AuthForm
      action={forgotAction}
      submit={l("Send reset link")}
      fields={[{ name: "email", label: l("Email"), type: "email", autoComplete: "email" }]}
      success={(state) => {
        const [before, after] = l("If {email} has a QuizoTab account, a link to choose a new password is on its way. It works for 60 minutes.").split("{email}");
        return (
          <div className="flex flex-col items-center gap-4 text-center">
            <MailCheck aria-hidden="true" className="size-12 text-cyan" />
            <h2 className="text-2xl font-extrabold text-white">{l("Check your email")}</h2>
            <p className="text-muted">
              {before}
              <strong className="text-text">{state.values?.email}</strong>
              {after}
            </p>
            <p className="text-muted">{l("Nothing after a few minutes? Check your spam folder.")}</p>
            <Link href="/" className={linkClass}>
              {l("Back to QuizoTab")}
            </Link>
          </div>
        );
      }}
      after={() => (
        <p className="mt-6 text-center text-sm text-muted">
          {l("Remembered it?")}{" "}
          <Link href="/login" className={linkClass}>
            {l("Log in")}
          </Link>
        </p>
      )}
    />
  );
}

export function ResetForm({ labels, token }: { labels: Labels; token: string }) {
  const l = reader(labels);
  return (
    <AuthForm
      action={resetAction}
      submit={l("Save new password")}
      hidden={{ token }}
      fields={[
        { name: "password", label: l("New password"), type: "password", autoComplete: "new-password", minLength: 8, hint: l("8 characters or more") },
        { name: "confirm", label: l("Type it again"), type: "password", autoComplete: "new-password", minLength: 8 },
      ]}
    />
  );
}
