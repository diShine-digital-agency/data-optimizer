import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <section className="container mx-auto max-w-xl py-20 text-center">
      <h1 className="mb-4 text-6xl">404</h1>
      <p className="mb-6 text-muted-foreground">{t("notFound.title")}</p>
      <Link to="/" className="text-accent underline">
        {t("notFound.back")}
      </Link>
    </section>
  );
}
