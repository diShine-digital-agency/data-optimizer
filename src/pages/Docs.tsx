import { useTranslation } from "react-i18next";

export default function Docs() {
  const { t } = useTranslation();
  return (
    <section className="container mx-auto max-w-3xl py-12">
      <h1 className="mb-4 text-4xl">{t("docs.title")}</h1>
      <p className="mb-6 text-muted-foreground">{t("docs.intro")}</p>
      <p>
        Full reference:{" "}
        <a
          className="text-accent underline"
          href="https://github.com/dishine/dishine-convert/blob/main/API.md"
          target="_blank"
          rel="noreferrer noopener"
        >
          API.md
        </a>{" "}
        ·{" "}
        <a
          className="text-accent underline"
          href="https://github.com/dishine/dishine-convert/blob/main/docs/openapi.yaml"
          target="_blank"
          rel="noreferrer noopener"
        >
          OpenAPI 3.1
        </a>
      </p>
    </section>
  );
}
