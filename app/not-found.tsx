import { Logo } from "@/components/site/logo";
import { ButtonLink } from "@/components/ui/button";
import { getTranslator } from "@/lib/i18n";

export default async function NotFound() {
  const { t } = await getTranslator();
  return (
    <main className="grid flex-1 place-items-center px-6 py-24 text-center">
      <div className="flex max-w-md flex-col items-center gap-6">
        <Logo />
        <h1 className="text-5xl font-extrabold text-white">{t("Page not found")}</h1>
        <p className="text-muted">{t("This page doesn't exist, or it hasn't been moved to the new QuizoTab yet.")}</p>
        <ButtonLink href="/">{t("Back to QuizoTab")}</ButtonLink>
      </div>
    </main>
  );
}
