import "server-only";
import { cookies, headers } from "next/headers";
import sw from "@/messages/sw.json";
import { LANG_COOKIE, LANG_HEADER, isLang, type Lang } from "./config";

const dictionaries: Record<Lang, Record<string, string>> = {
  en: {},
  sw,
};

// The language for this request: a ?lang= switch (passed on by proxy.ts), then the saved choice,
// then the browser's language. Same order as the PHP site's qt_lang().
export async function getLang(): Promise<Lang> {
  const requestHeaders = await headers();
  const asked = requestHeaders.get(LANG_HEADER);
  if (isLang(asked)) return asked;

  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(saved)) return saved;

  return (requestHeaders.get("accept-language") ?? "").toLowerCase().startsWith("sw") ? "sw" : "en";
}

export type Translate = (english: string) => string;

// Pages are written in English. t("Host a tournament") returns the Swahili when the visitor reads
// Swahili; a sentence missing from messages/sw.json simply stays in English.
export async function getTranslator(): Promise<{ lang: Lang; t: Translate }> {
  const lang = await getLang();
  const dictionary = dictionaries[lang];
  return { lang, t: (english) => dictionary[english] ?? english };
}

// The translations a client component needs, as a plain object it can receive: { "Email": "Barua pepe", ... }
export function labelsFor(t: Translate, english: readonly string[]) {
  return Object.fromEntries(english.map((text) => [text, t(text)]));
}
