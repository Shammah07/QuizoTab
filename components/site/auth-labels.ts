// The words each account form needs. Pages translate these on the server and hand them to the form.
// Kept apart from auth-forms.tsx because server pages can't read plain values out of a "use client" file.

export const LOGIN_LABELS = ["Email", "Password", "Login", "Forgot password?", "Don't have an account?", "Register", "Didn't get the email?", "Send it again"];

export const REGISTER_LABELS = ["Name", "Email", "Password", "8 characters or more", "Register", "Already have an account?", "Login"];

export const FORGOT_LABELS = [
  "Email",
  "Send reset link",
  "Remembered it?",
  "Log in",
  "Check your email",
  "If {email} has a QuizoTab account, a link to choose a new password is on its way. It works for 60 minutes.",
  "Nothing after a few minutes? Check your spam folder.",
  "Back to QuizoTab",
];

export const RESET_LABELS = ["New password", "Type it again", "8 characters or more", "Save new password"];
