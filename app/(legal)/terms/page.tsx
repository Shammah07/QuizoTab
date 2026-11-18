/* eslint-disable react/no-unescaped-entities */
import type { Metadata } from "next";
import { LegalContact, LegalPage } from "@/components/site/legal-page";
import { formatPrice } from "@/lib/pricing";

const summary =
  "These terms explain how QuizoTab works, what you pay for, what you can expect from us and what we expect from you. By creating an account, hosting a tournament or playing a quiz, you agree to them.";

const sections = {
  "about": "About QuizoTab",
  "accounts": "Your account",
  "tournaments": "Tournaments and payment",
  "quizzes": "Live quizzes",
  "content": "Your content",
  "use": "Acceptable use",
  "public": "Public pages and sharing",
  "availability": "Availability",
  "ending": "Deleting and suspending",
  "liability": "Our responsibility",
  "changes": "Changes to these terms",
  "law": "Law and disputes",
  "contact": "Contact us"
};

export const metadata: Metadata = { title: "Terms of service", description: summary, alternates: { canonical: "/terms" } };

export default function TermsOfServicePage() {
  return (
    <LegalPage slug="terms" summary={summary} sections={sections}>
      <h2 id="about">1. About QuizoTab</h2>
      <p>QuizoTab is an online service for running quiz events. People, organisations and institutions use it to host <strong>tournaments</strong> (with teams, rounds, judges, scores and live standings) and <strong>live quizzes</strong> (questions on a screen that players answer from their phones).</p>
      <p>In these terms, "QuizoTab", "we" and "us" mean the team that runs QuizoTab. "You" means anyone who uses the site: hosts, judges, players and visitors.</p>

      <h2 id="accounts">2. Your account</h2>
      <ul>
          <li>You need an account to host tournaments or create quizzes. Players and visitors don't.</li>
          <li>Give your real name and an email address you can reach. We send email checks and password resets to it.</li>
          <li>Keep your password private. You are responsible for what happens under your account, including judge logins you create for your tournaments.</li>
          <li>To pay for a tournament you must be at least 18, or have permission from the organisation or adult you are paying for.</li>
          <li>Tell us straight away if you think someone else is using your account.</li>
      </ul>

      <h2 id="tournaments">3. Tournaments and payment</h2>
      <p>Each tournament is paid for once, before it is created. The price depends on the format you choose:</p>
      <table className="legal-table">
          <thead><tr><th scope="col">Format</th><th scope="col">Price per tournament</th></tr></thead>
          <tbody>
              <tr><td>Quiz night</td><td>{formatPrice("quiz-night")}</td></tr>
              <tr><td>League</td><td>{formatPrice("league")}</td></tr>
              <tr><td>Knockout cup</td><td>{formatPrice("knockout")}</td></tr>
              <tr><td>Championship</td><td>{formatPrice("championship")}</td></tr>
          </tbody>
      </table>
      <ul>
          <li>Prices are in Tanzanian shillings and are shown before you pay. The amount on the payment page is the amount you pay.</li>
          <li>Payments are handled by <strong>Pesapal</strong>, a licensed payment provider. You can pay by mobile money or card on Pesapal's secure page. QuizoTab never sees your card number or mobile money PIN.</li>
          <li>Your tournament is created as soon as Pesapal confirms the payment. If the confirmation is delayed, it is created automatically when it arrives.</li>
          <li>One payment covers one tournament: as many teams, rounds, judges and rooms as you need, for as long as you keep it.</li>
          <li>We may change prices in the future. A change never affects a tournament you have already paid for.</li>
          <li>Refunds are covered in our <a href="/refund">Refund policy</a>.</li>
      </ul>

      <h2 id="quizzes">4. Live quizzes</h2>
      <p>Creating, hosting and playing live quizzes is free. Players join with a game PIN and the name they type; they don't need an account. If you make a quiz public, anyone can find it and play it on their own, and it shows your first name as the author.</p>

      <h2 id="content">5. Your content</h2>
      <p>Everything you add stays yours: tournament names, team names, rounds, scores, quiz questions and answers. You give QuizoTab permission to store, show and share that content only as needed to run the service, for example showing standings on your tournament's public page or a public quiz on the Play page.</p>
      <p>You are responsible for your content and for having the right to use it. Don't upload questions, images or names you don't have permission to use.</p>

      <h2 id="use">6. Acceptable use</h2>
      <p>Don't use QuizoTab to:</p>
      <ul>
          <li>break the law, or help someone else break it;</li>
          <li>post hateful, threatening, sexual or violent content, or content that targets a person or group;</li>
          <li>share other people's personal information without their permission;</li>
          <li>try to get into accounts, tournaments or data that aren't yours, or to change scores you aren't allowed to change;</li>
          <li>avoid paying for a tournament, or overload, copy or interfere with the service.</li>
      </ul>

      <h2 id="public">7. Public pages and sharing</h2>
      <p>A tournament can have a public page with its standings and draw. As the host, you choose whether it is listed in QuizoTab's directory and whether visitors need a guest code. Team names and scores on public pages can be seen by anyone with the link, so don't use personal details in team names unless the people involved agree.</p>

      <h2 id="availability">8. Availability</h2>
      <p>We work to keep QuizoTab running smoothly, especially during live events, but we can't promise it will never be interrupted. The service needs a working internet connection on the host's and judges' devices. We may update features or carry out maintenance; where we can, we do this outside busy event times and give notice of major changes.</p>

      <h2 id="ending">9. Deleting and suspending</h2>
      <ul>
          <li>You can delete a tournament at any time from <strong>Your tournaments</strong>. This permanently removes its teams, scores, settings and judge logins, and can't be undone.</li>
          <li>To close your account, write to us from the email address on the account and we will delete it.</li>
          <li>We may suspend or close an account that seriously or repeatedly breaks these terms. Where possible we will tell you first and give you a chance to fix the problem.</li>
      </ul>

      <h2 id="liability">10. Our responsibility</h2>
      <p>QuizoTab is provided as it is. Nothing in these terms removes rights you have under Tanzanian consumer law.</p>
      <p>As far as the law allows, we are not responsible for indirect losses, such as lost prize money, lost business or the cost of rescheduling an event. Our total responsibility to you for any claim is limited to the amount you paid QuizoTab in the 12 months before the claim.</p>

      <h2 id="changes">11. Changes to these terms</h2>
      <p>We may update these terms as QuizoTab grows. The date at the top shows the latest version. If a change is important, we will tell account holders by email or on the site before it applies. Using QuizoTab after a change means you accept the new terms.</p>

      <h2 id="law">12. Law and disputes</h2>
      <p>These terms are governed by the laws of the United Republic of Tanzania. If something goes wrong, please contact us first so we can try to put it right. If we can't agree, the dispute will be handled by the courts of Tanzania.</p>

      <h2 id="contact">13. Contact us</h2>
      <p>Questions about these terms:</p>
      <LegalContact />
    </LegalPage>
  );
}
