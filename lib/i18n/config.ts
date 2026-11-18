export const LANGS = ["en", "sw"] as const;
export type Lang = (typeof LANGS)[number];

// Same cookie name as the PHP site, so returning visitors keep their language
export const LANG_COOKIE = "qt_lang";
export const LANG_HEADER = "x-qt-lang";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}
