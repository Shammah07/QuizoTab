"use client";

import { useActionState, type ReactNode } from "react";
import type { FormState } from "@/app/(auth)/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type AuthField = {
  name: string;
  label: string;
  type: "text" | "email" | "password";
  autoComplete: string;
  minLength?: number;
  maxLength?: number;
  hint?: string;
};

type Props = {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  fields: AuthField[];
  submit: string;
  // Sent along without being shown (the reset token, where to go after login)
  hidden?: Record<string, string>;
  // Values to start with, e.g. the email a visitor already typed on another page
  initial?: Record<string, string>;
  // Shown instead of the form once it was sent successfully
  success?: (state: FormState) => ReactNode;
  // Shown under the form, with the latest result (the "Send it again" box on the login page)
  after?: (state: FormState) => ReactNode;
  children?: ReactNode;
};

// One form for login, register, forgot password and new password. It works before the page's
// JavaScript has loaded too, because it posts straight to a server action.
export function AuthForm({ action, fields, submit, hidden, initial, success, after, children }: Props) {
  const [state, formAction, pending] = useActionState(action, {});

  if (state.type === "success" && success) return <>{success(state)}</>;

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4">
        {state.message && !state.field && <Alert type={state.type ?? "error"}>{state.message}</Alert>}

        {Object.entries(hidden ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}

        {fields.map((field, i) => (
          <Input
            key={field.name}
            {...field}
            required
            autoFocus={i === 0}
            // Passwords are never filled back in
            defaultValue={field.type === "password" ? undefined : (state.values?.[field.name] ?? initial?.[field.name])}
            error={state.field === field.name ? state.message : undefined}
          />
        ))}

        {children}

        <Button type="submit" disabled={pending} aria-busy={pending} className="mt-2 w-full">
          {submit}
        </Button>
      </form>
      {after?.(state)}
    </>
  );
}
