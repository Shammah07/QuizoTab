import "server-only";

// What one tournament costs in each format. Set in the environment (was TOURNAMENT_PRICES in the private
// PHP settings), for example:
//   TOURNAMENT_CURRENCY=TZS
//   TOURNAMENT_PRICES={"quiz-night":50000,"league":0,"knockout":0,"championship":0}
// The price charged always comes from here, never from the browser.

export const FORMATS = ["championship", "quiz-night", "league", "knockout"] as const;
export type TournamentFormat = (typeof FORMATS)[number];

export const currency = process.env.TOURNAMENT_CURRENCY ?? "TZS";

function prices(): Partial<Record<TournamentFormat, number>> {
  try {
    // Empty counts as "not set yet", the same as missing
    return JSON.parse(process.env.TOURNAMENT_PRICES || "{}");
  } catch {
    console.error("QuizoTab: TOURNAMENT_PRICES is not valid JSON.");
    return {};
  }
}

// The price of a format, or null while prices haven't been set
export function tournamentPrice(format: TournamentFormat): number | null {
  const amount = prices()[format];
  return typeof amount === "number" && amount >= 0 ? amount : null;
}

// "TZS 50,000" as shown to hosts and on the policy pages
export function formatPrice(format: TournamentFormat) {
  const amount = tournamentPrice(format);
  return amount === null ? "Shown before you pay" : `${currency} ${amount.toLocaleString("en-US")}`;
}
