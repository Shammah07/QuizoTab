import { LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import { HeroCarousel, type HeroSlide } from "@/components/site/hero-carousel";
import { SampleBoard } from "@/components/site/sample-board";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { TournamentDemo } from "@/components/site/tournament-demo";
import { UsesTabs, type Use } from "@/components/site/uses-tabs";
import { ButtonLink } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { getTranslator } from "@/lib/i18n";
import { contact, site } from "@/lib/site";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    languages: { en: "/?lang=en", sw: "/?lang=sw", "x-default": "/" },
  },
};

// The landing page: header, hero with the live sample board beside it, "what it can do for you"
// tabs, the interactive tournament demo, the six steps, contact and footer.
export default async function HomePage() {
  const { lang, t } = await getTranslator();
  const session = await getSession();

  const slides: HeroSlide[] = [
    {
      id: "hero-about",
      tab: "QuizoTab",
      title: t("Quiz tournaments and live quizzes the whole room can follow"),
      text: t(
        "QuizoTab is where schools, universities, companies and communities run their quiz events. Host a full tournament with judges and live standings, or put a quiz on the big screen and let everyone play on their phones.",
      ),
      actions: [
        { href: "/host", label: t("Host a tournament") },
        { href: "/quiz/explore", label: t("Play a quiz") },
      ],
    },
    {
      id: "hero-tournaments",
      tab: t("Tournaments"),
      tag: t("Tournaments"),
      title: t("Run the whole tournament from one dashboard"),
      text: t(
        "Register the teams and set your rounds. Judges score from their phones, you approve every result, the next draw is made for you, and the standings update on the big screen until a champion is crowned.",
      ),
      actions: [
        { href: "/host", label: t("Host a tournament") },
        { href: "#steps", label: t("See how it works") },
      ],
    },
    {
      id: "hero-quizzes",
      tab: t("Live quizzes"),
      tag: t("Live quizzes"),
      title: t("Quizzes the whole room plays at once"),
      text: t(
        "Put a quiz on the big screen and everyone answers on their own phone with a PIN, free. Faster right answers score more, the leaderboard updates after every question, and a podium crowns the winner.",
      ),
      actions: [
        { href: "/quiz/explore", label: t("Play a quiz now") },
        { href: "/quiz", label: t("Create your own quiz") },
      ],
    },
  ];

  // Team and event names are examples and stay as written; the sentences are translated
  const uses: Use[] = [
    {
      key: "schools",
      title: t("Schools and inter-university quizzes"),
      text: t("Teachers judge from their phones while students compete. Parents and classmates follow the standings from anywhere through the audience link."),
      points: [t("Register every school's and university's team in minutes"), t("Swiss rounds pair schools of similar strength"), t("Knockout rounds decide the champion school")],
      event: t("Regional Schools Quiz, round 4"),
      board: [["Kibaha Secondary", 2310], ["Mzumbe Secondary", 2240], ["Tabora Boys", 2105], ["Msalato Girls", 1980]],
    },
    {
      key: "clubs",
      title: t("Quiz and debate clubs"),
      text: t("Run a weekly league or a weekend championship. QuizoTab handles the draw, the rooms and the judge panels, round after round."),
      points: [t("New pairings are generated after every round"), t("Each room gets a host judge and panelists"), t("Members check their standing from their own phones")],
      event: t("City Quiz League, week 6"),
      board: [["Bongo Brains", 1875], ["The Thinkers", 1820], ["Quiz Lions", 1760], ["Night Owls", 1690]],
    },
    {
      key: "companies",
      title: t("Companies and team building"),
      text: t("Turn departments into teams for an evening. The leaderboard on the big screen keeps the whole room watching until the last question."),
      points: [t("Departments compete as teams"), t("Managers judge and approve the scores"), t("The final standings crown the winning department")],
      event: t("Staff Quiz Night, round 3"),
      board: [["Finance", 1450], ["IT Support", 1395], ["Sales", 1340], ["Marketing", 1210]],
    },
    {
      key: "communities",
      title: t("Community and faith events"),
      text: t("Youth groups, churches and community centres run friendly tournaments with nothing more than a projector and a few phones."),
      points: [t("Nothing to install: it all runs in the browser"), t("Anyone can follow along with the audience link"), t("Works on any phone with a browser")],
      event: t("Youth Bible Quiz, semi-finals"),
      board: [["St. Joseph Youth", 980], ["Upanga Juniors", 955], ["Kijitonyama Stars", 910], ["Mbezi Lights", 870]],
    },
  ];

  const steps = [
    [t("Create your account"), t("Sign up on QuizoTab and open Host a Tournament.")],
    [t("Name your tournament"), t("Add the name, category, year and dates.")],
    [t("Set the rounds"), t("Choose how many rounds, the knockout stages and the scoring rules.")],
    [t("Add judges and rooms"), t("Judges register the teams and get their rooms.")],
    [t("Play the rounds"), t("Judges score each match, you approve, and the draw for the next stage follows.")],
    [t("Crown a winner"), t("Quarter-finals, semi-finals and the final, all on the big screen.")],
  ];

  const promises = [
    t("Passwords are stored as one-way hashes, never as readable text."),
    t("Only you and the judges you add can change your tournament's scores."),
    t("Audience pages show the draw and scores. Emails and passwords never appear there."),
  ];

  // Tells search engines what QuizoTab is (was the ld+json block in index.php)
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: site.name,
    url: site.url,
    description: site.description,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Any",
    inLanguage: ["en", "sw"],
  };

  const sectionTitle = "text-[clamp(32px,4vw,52px)] leading-[1.05] font-extrabold text-white";
  const sectionText = "mt-4 mb-12 max-w-[60ch] text-[17px] leading-relaxed text-muted";

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <SiteHeader lang={lang} t={t} session={session} />

      <main id="top" className="flex-1">
        {/* The hero is the product: the words on the left, the live board on the right */}
        <section className="border-b border-line px-(--edge) pt-14 pb-16 lg:pt-20 lg:pb-24">
          <div className="mx-auto grid max-w-page items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
            <HeroCarousel slides={slides} label={t("About QuizoTab")} pickerLabel={t("Choose a slide")} />
            <SampleBoard
              labels={{
                live: t("Live"),
                name: t("Lake Zone Schools Quiz"),
                sample: t("(sample)"),
                afterRound: t("After round {n} of {total}"),
                final: t("Final standings"),
                scoreRound: t("Score round {n}"),
                startOver: t("Start over"),
                winners: t("{team} win the tournament"),
                up: t("up {n}"),
                down: t("down {n}"),
              }}
            />
          </div>
        </section>

        <section id="uses" className="scroll-mt-8 pt-24">
          <div className="mx-auto max-w-page px-6">
            <h2 className={sectionTitle}>{t("What QuizoTab can do for you")}</h2>
            <p className={sectionText}>{t("The same scoreboard works for any crowd. Pick the kind of event you run.")}</p>
            <UsesTabs uses={uses} label={t("Kinds of events")} />
          </div>
        </section>

        <section id="demo" className="scroll-mt-8 border-y border-line bg-studio-deep py-24">
          <div className="mx-auto max-w-page px-6">
            <h2 className={sectionTitle}>{t("One tournament, three screens")}</h2>
            <p className={sectionText}>
              {t("Every score travels the same path, from the judge's phone to the admin console to the big screen. Watch it happen below, or take over and try it yourself.")}
            </p>
            <TournamentDemo
              labels={{
                judge: t("The judge scores"),
                admin: t("The admin approves"),
                room: t("The room sees it"),
                demoSteps: t("Demo steps"),
                roomTitle: t("Lake Zone Schools Quiz"),
                lowerKilimanjaro: t("Lower Kilimanjaro High's score"),
                raiseKilimanjaro: t("Raise Kilimanjaro High's score"),
                lowerMwanza: t("Lower Mwanza Owls' score"),
                raiseMwanza: t("Raise Mwanza Owls' score"),
                submitScore: t("Submit score"),
                approveScore: t("Approve score"),
                noScoresWaiting: t("No scores waiting"),
                waitingForJudge: t("Waiting for the judge"),
                semiFinalRoom: t("Room 2, semi-final"),
                nextRound: t("Next round"),
                points: t("points"),
                round: t("Round"),
                submitted: t("Score sent for review"),
                approved: t("Approved — standings updated"),
              }}
            />
          </div>
        </section>

        <section id="steps" className="scroll-mt-8 py-24">
          <div className="mx-auto max-w-page px-6">
            <h2 className={sectionTitle}>{t("From sign-up to the final")}</h2>
            <ol className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {steps.map(([title, text], i) => (
                <li key={title} className="text-[15px] leading-relaxed text-muted">
                  <span aria-hidden="true" className="wide grid size-11 place-items-center bg-live font-display text-xl font-extrabold text-white">
                    {i + 1}
                  </span>
                  <strong className="mt-4 mb-1 block text-lg font-semibold text-white">{title}</strong>
                  {text}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="contact" className="scroll-mt-8 border-t border-line">
          <div className="mx-auto grid max-w-page md:grid-cols-2">
            <div className="px-6 py-20 md:py-28 md:pr-14">
              <h2 className="text-[clamp(30px,4vw,46px)] leading-[1.05] font-extrabold text-white">{t("Still wondering if QuizoTab fits your event?")}</h2>
              <p className="mt-4 mb-10 max-w-[60ch] text-[17px] leading-relaxed text-muted">
                {t("Tell us about your tournament: how many teams, how many rooms, and when it happens. We'll help you set it up, or you can start right away.")}
              </p>
              <div className="flex flex-wrap gap-3">
                <ButtonLink href={`mailto:${contact.email}?subject=Question%20about%20QuizoTab`}>{t("Email us")}</ButtonLink>
                <ButtonLink href="/host" variant="line">
                  {t("Host a tournament")}
                </ButtonLink>
              </div>
            </div>

            <div className="bg-panel px-6 py-20 md:py-28 md:pl-14">
              <LockKeyhole aria-hidden="true" className="mb-6 size-12 text-live" strokeWidth={1.5} />
              <h2 className="text-[clamp(30px,4vw,46px)] leading-[1.05] font-extrabold text-white">{t("Your data stays yours")}</h2>
              <ul className="mt-6 flex list-disc flex-col gap-3 pl-5 text-[16px] leading-relaxed text-text marker:text-live">
                {promises.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter t={t} />
    </>
  );
}
