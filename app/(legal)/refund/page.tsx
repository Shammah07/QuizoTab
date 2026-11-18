/* eslint-disable react/no-unescaped-entities */
import type { Metadata } from "next";
import { LegalContact, LegalPage } from "@/components/site/legal-page";
import { formatPrice } from "@/lib/pricing";

const summary =
  "Live quizzes are free, so this policy is about tournament payments. If you were charged by mistake, charged twice, or change your mind before your tournament is used, you get your money back.";

const sections = {
  "covered": "What this covers",
  "eligible": "When you get a refund",
  "not": "When we can't refund",
  "request": "How to ask for a refund",
  "timing": "How long it takes",
  "disputes": "Payment disputes",
  "contact": "Contact us"
};

export const metadata: Metadata = { title: "Refund policy", description: summary, alternates: { canonical: "/refund" } };

export default function RefundPolicyPage() {
  return (
    <LegalPage slug="refund" summary={summary} sections={sections}>
      <h2 id="covered">1. What this covers</h2>
      <p>This policy covers payments for tournaments on QuizoTab. Tournaments are paid for once, before they are created:</p>
      <table className="legal-table">
          <thead><tr><th scope="col">Format</th><th scope="col">Price</th></tr></thead>
          <tbody>
              <tr><td>Quiz night</td><td>{formatPrice("quiz-night")}</td></tr>
              <tr><td>League</td><td>{formatPrice("league")}</td></tr>
              <tr><td>Knockout cup</td><td>{formatPrice("knockout")}</td></tr>
              <tr><td>Championship</td><td>{formatPrice("championship")}</td></tr>
          </tbody>
      </table>
      <p>Creating, hosting and playing live quizzes is free, so there is nothing to refund for them.</p>

      <h2 id="eligible">2. When you get a refund</h2>
      <h3>Full refund</h3>
      <ul>
          <li><strong>You were charged more than once</strong> for the same tournament. We refund every extra payment.</li>
      </ul>
      <h3>Wrong format</h3>
      <p>If you paid for the wrong format and haven't used the tournament yet, tell us within 3 days. We can switch it to the right format and refund the difference if the new one costs less. If it costs more, you pay only the difference.</p>

      <h2 id="not">3. When we can't refund</h2>
      <ul>
          <li>The tournament has been used (teams added or scores entered) and QuizoTab worked as it should.</li>
          <li>More than 3 days have passed since payment, except for the payment errors in section 2.</li>
          <li>You deleted the tournament yourself. Deleting is permanent, so a refund <em>cannot</em> happen.</li>
          <li>The event was cancelled, postponed or affected by something outside QuizoTab, such as a power cut, poor internet at the venue or bad weather.</li>
          <li>The account was closed for breaking our <a href="/terms">Terms of service</a>.</li>
      </ul>

      <h2 id="request">4. How to ask for a refund</h2>
      <p>Email us from the address on your QuizoTab account and include:</p>
      <ol>
          <li>Your name and the email address on the account;</li>
          <li>The tournament name and the date you paid;</li>
          <li>The payment reference from Pesapal's receipt or confirmation message;</li>
          <li>A short reason for the refund.</li>
      </ol>
      <p>We reply within 3 working days to say whether the refund is approved.</p>

      <h2 id="timing">5. How long it takes</h2>
      <p>Approved refunds are sent through Pesapal to the method you paid with: the same mobile money number or card. Once we have sent it, the time it takes to reach you depends on your provider:</p>
      <table className="legal-table">
          <thead><tr><th scope="col">Paid with</th><th scope="col">Usually arrives in</th></tr></thead>
          <tbody>
              <tr><td>Mobile money</td><td>1–5 working days</td></tr>
              <tr><td>Card</td><td>7–14 working days</td></tr>
          </tbody>
      </table>
      <p>A refunded tournament is closed and its data deleted, unless we agreed on a replacement.</p>

      <h2 id="disputes">6. Payment disputes</h2>
      <p>Please contact us before opening a dispute or chargeback with your bank or mobile money provider. Most problems can be fixed faster directly. If a dispute is opened, the tournament may be paused until it is settled.</p>

      <h2 id="contact">7. Contact us</h2>
      <p>Refund questions and requests:</p>
      <LegalContact />
    </LegalPage>
  );
}
