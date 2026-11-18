/* eslint-disable react/no-unescaped-entities */
import type { Metadata } from "next";
import { LegalContact, LegalPage } from "@/components/site/legal-page";

const summary =
  "We collect only what we need to run your quizzes and tournaments, we never sell your information, and you can ask us to see or delete it at any time.";

const sections = {
  "collect": "What we collect",
  "use": "How we use it",
  "share": "Who we share it with",
  "payments": "Payments",
  "public": "What others can see",
  "cookies": "Cookies and storage",
  "keep": "How long we keep it",
  "security": "Keeping it safe",
  "rights": "Your rights",
  "children": "Children",
  "changes": "Changes to this policy",
  "contact": "Contact us"
};

export const metadata: Metadata = { title: "Privacy policy", description: summary, alternates: { canonical: "/privacy" } };

export default function PrivacyPolicyPage() {
  return (
    <LegalPage slug="privacy" summary={summary} sections={sections}>
      <h2 id="collect">1. What we collect</h2>
      <h3>When you create an account</h3>
      <ul>
          <li>Your name, email address and password. Passwords are stored scrambled (hashed), so no one at QuizoTab can read them.</li>
          <li>Whether you have confirmed your email, and the date you joined.</li>
      </ul>
      <h3>When you host a tournament</h3>
      <ul>
          <li>The tournament's name, category, dates and settings.</li>
          <li>Team names, rounds, scores, rooms and draws you enter.</li>
          <li>The name and email of each judge you invite, so they can sign in and score.</li>
      </ul>
      <h3>When you create or play a live quiz</h3>
      <ul>
          <li>Your questions and answers, if you create a quiz.</li>
          <li>The name you type to join a game, your answers, and your score. Players don't need an account.</li>
      </ul>
      <h3>When you pay</h3>
      <ul>
          <li>The amount, the payment reference, the payment method type (for example "M-Pesa" or "Visa") and whether the payment succeeded. We never receive your card number or mobile money PIN.</li>
      </ul>
      <h3>Automatically</h3>
      <ul>
          <li>Basic technical information that every website receives, such as your IP address and browser type, kept in server logs to keep the site secure and working.</li>
      </ul>

      <h2 id="use">2. How we use it</h2>
      <ul>
          <li>To run your account, tournaments and quizzes, and to show standings and leaderboards.</li>
          <li>To process payments and create the tournament you paid for.</li>
          <li>To send emails you need: email checks, password resets, and messages about your payments or account.</li>
          <li>To answer your questions and handle refunds.</li>
          <li>To keep QuizoTab secure and prevent misuse.</li>
      </ul>
      <p>We don't sell your information, we don't show adverts, and we don't use your information to target you with marketing from other companies.</p>

      <h2 id="share">3. Who we share it with</h2>
      <p>We share information only with the services that help us run QuizoTab, and only what each one needs:</p>
      <ul>
          <li><strong>Pesapal</strong>: processes tournament payments.</li>
          <li><strong>Supabase</strong>: stores tournament data and judge sign-ins.</li>
          <li><strong>Google (Gmail)</strong>: sends our account emails.</li>
          <li><strong>Our web hosting provider</strong>: runs the servers the site is on.</li>
      </ul>
      <p>Some of these services store data on servers outside Tanzania. We use providers that protect data with industry-standard security. We may also share information if the law requires it, or to protect people's safety.</p>

      <h2 id="payments">4. Payments</h2>
      <p>When you pay for a tournament, you enter your payment details on <strong>Pesapal's</strong> secure page, not on QuizoTab. Pesapal handles that information under its own privacy policy. Pesapal tells us whether the payment succeeded, along with the reference we need for your receipt and for any refund.</p>

      <h2 id="public">5. What others can see</h2>
      <ul>
          <li><strong>Tournament public pages</strong> show the tournament name, team names, scores and standings to anyone with the link. You choose whether the tournament is listed publicly and whether visitors need a guest code.</li>
          <li><strong>Public quizzes</strong> show the quiz and your first name as the author. Leaderboards show the names players typed.</li>
          <li>Your email address is never shown on public pages.</li>
      </ul>

      <h2 id="cookies">6. Cookies and storage</h2>
      <p>QuizoTab uses only what it needs to work:</p>
      <ul>
          <li>a <strong>session cookie</strong> that keeps you signed in, removed when you log out or close the browser;</li>
          <li>a <strong>language cookie</strong> that remembers whether you chose English or Kiswahili, kept for one year;</li>
          <li><strong>storage in your browser</strong> that remembers which tournament you last opened and keeps you signed in to tournament tools.</li>
      </ul>
      <p>We don't use advertising or tracking cookies.</p>

      <h2 id="keep">7. How long we keep it</h2>
      <ul>
          <li><strong>Account information</strong>: until you ask us to delete your account.</li>
          <li><strong>Tournaments</strong>: until you delete them. Deleting removes the teams, scores, settings and judge logins straight away.</li>
          <li><strong>Payment records</strong>: kept as receipts even after a tournament is deleted, because tax law requires business records to be kept for a number of years (currently five in Tanzania). Only the name and format of a deleted tournament stay with its receipt.</li>
          <li><strong>Server logs</strong>: kept for a short time for security, then deleted.</li>
      </ul>

      <h2 id="security">8. Keeping it safe</h2>
      <p>We use encrypted connections (HTTPS), hashed passwords and access rules, so each host can see and change only their own tournaments, and judges can score only the tournaments they were invited to. Secret keys are kept on our server, out of public reach. No system is perfectly secure; if a breach affects your information, we will tell you and the authorities as the law requires.</p>

      <h2 id="rights">9. Your rights</h2>
      <p>Under Tanzania's Personal Data Protection Act, 2022, you can ask us to:</p>
      <ul>
          <li>show you the personal information we hold about you;</li>
          <li>correct information that is wrong;</li>
          <li>delete your information, unless the law requires us to keep it (such as payment records);</li>
          <li>stop using your information for a particular purpose.</li>
      </ul>
      <p>Write to us from the email address on your account and we will reply within 30 days. If you are not happy with our answer, you can complain to the Personal Data Protection Commission (PDPC) of Tanzania.</p>

      <h2 id="children">10. Children</h2>
      <p>Children can play live quizzes without an account, using just a name. Accounts are for hosts aged 13 and over, and paying for tournaments is for adults. Schools and organisers running events for children should use first names or team names, not full names, on public pages.</p>

      <h2 id="changes">11. Changes to this policy</h2>
      <p>If we change how we use your information, we will update this page and the date at the top. For important changes, we will tell account holders by email before they apply.</p>

      <h2 id="contact">12. Contact us</h2>
      <p>Privacy questions and requests:</p>
      <LegalContact />
    </LegalPage>
  );
}
