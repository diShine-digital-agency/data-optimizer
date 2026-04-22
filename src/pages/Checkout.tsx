import { Routes, Route, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

function Return() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const status = params.get("status");
  if (status === "cancelled") {
    return <p className="text-muted-foreground">{t("checkout.cancelled")}</p>;
  }
  return <p>{t("checkout.success")}</p>;
}

function Start() {
  const { t } = useTranslation();
  return <p className="text-muted-foreground">{t("checkout.upgrading")}</p>;
}

export default function Checkout() {
  return (
    <section className="container mx-auto max-w-2xl py-12">
      <Routes>
        <Route index element={<Start />} />
        <Route path="return" element={<Return />} />
      </Routes>
    </section>
  );
}
