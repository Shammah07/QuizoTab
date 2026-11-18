import "server-only";
import nodemailer from "nodemailer";
import { VERIFY_HOURS, RESET_MINUTES } from "@/lib/auth/accounts";
import { isProduction } from "@/lib/env";
import { site } from "@/lib/site";

// Sends QuizoTab's emails through the same SMTP account the PHP site used (was PHPMailer in account.php).

type Mail = {
  to: string;
  name: string;
  subject: string;
  heading: string;
  text: string;
  button: string;
  link: string;
  footnote: string;
};

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function smtp() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const port = Number(process.env.SMTP_PORT ?? 587);
  return nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
}

// True when the email was handed to the mail server
export async function sendMail(mail: Mail) {
  const s = escapeHtml;
  const html =
    `<div style="background:#100A35;padding:32px 16px;font-family:Poppins,Arial,sans-serif">` +
    `<div style="max-width:480px;margin:0 auto;background:#24115F;border-radius:16px;padding:32px;color:#F3EEFF">` +
    `<p style="margin:0 0 24px;font-size:22px;font-weight:800">Quizo<span style="color:#FF3EA5">Tab</span></p>` +
    `<h1 style="margin:0 0 12px;font-size:20px">${s(mail.heading)}</h1>` +
    `<p style="margin:0 0 24px;line-height:1.6;color:#B9B0DA">Hi ${s(mail.name)}, ${s(mail.text)}</p>` +
    `<a href="${s(mail.link)}" style="display:inline-block;background:#FF3EA5;color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:40px">${s(mail.button)}</a>` +
    `<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#B9B0DA">${s(mail.footnote)}<br>Or paste this link into your browser:<br>` +
    `<span style="color:#38E3EA;word-break:break-all">${s(mail.link)}</span></p></div></div>`;
  const plain = `Hi ${mail.name}, ${mail.text}\n\n${mail.button}: ${mail.link}\n\n${mail.footnote}`;

  const transport = smtp();
  if (!transport) {
    // Until SMTP is set up, emails on your own computer are printed in the terminal running "npm run dev"
    if (isProduction) {
      console.error("QuizoTab mail not sent: SMTP_HOST, SMTP_USER and SMTP_PASS are not set.");
      return false;
    }
    console.log(`\n--- Email (not sent, SMTP is not set up) ---\nTo: ${mail.to}\nSubject: ${mail.subject}\n${plain}\n---\n`);
    return true;
  }

  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM ?? `QuizoTab <${process.env.SMTP_USER}>`,
      to: { name: mail.name, address: mail.to },
      subject: mail.subject,
      html,
      text: plain,
    });
    return true;
  } catch (error) {
    console.error("QuizoTab mail failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

type Recipient = { name: string; email: string };

export function sendVerificationEmail(user: Recipient, token: string) {
  return sendMail({
    to: user.email,
    name: user.name,
    subject: "Confirm your QuizoTab email",
    heading: "Confirm your email",
    text: "thanks for joining QuizoTab. Confirm this is your email address to start hosting tournaments.",
    button: "Confirm email",
    link: `${site.url}/verify?token=${token}`,
    footnote: `This link works for ${VERIFY_HOURS} hours. If you didn't create a QuizoTab account, you can ignore this email.`,
  });
}

export function sendResetEmail(user: Recipient, token: string) {
  return sendMail({
    to: user.email,
    name: user.name,
    subject: "Reset your QuizoTab password",
    heading: "Reset your password",
    text: "we got a request to reset your QuizoTab password. Choose a new one with the button below.",
    button: "Choose a new password",
    link: `${site.url}/reset?token=${token}`,
    footnote: `This link works for ${RESET_MINUTES} minutes and only once. If you didn't ask for this, ignore this email and your password stays the same.`,
  });
}
