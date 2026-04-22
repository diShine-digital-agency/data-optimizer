import { lazy, Suspense } from "react";
import { Routes, Route, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

const Home = lazy(() => import("./pages/Home"));
const Docs = lazy(() => import("./pages/Docs"));
const Account = lazy(() => import("./pages/Account"));
const Auth = lazy(() => import("./pages/Auth"));
const Checkout = lazy(() => import("./pages/Checkout"));
const Ops = lazy(() => import("./pages/Admin")); // operator-only, not linked in nav
const NotFound = lazy(() => import("./pages/NotFound"));

function Nav() {
  const { t, i18n } = useTranslation();
  const cycle = () => {
    const order = ["en", "it", "fr"] as const;
    const i = order.indexOf(i18n.language as (typeof order)[number]);
    const next = order[(i + 1) % order.length] ?? "en";
    void i18n.changeLanguage(next);
  };
  return (
    <header className="border-b border-border">
      <nav className="container mx-auto flex items-center justify-between py-4">
        <Link to="/" className="font-serif text-xl">
          Dishine Convert
        </Link>
        <ul className="flex items-center gap-6 text-sm">
          <li>
            <Link to="/docs">{t("nav.docs")}</Link>
          </li>
          <li>
            <Link to="/account">{t("nav.account")}</Link>
          </li>
          <li>
            <Link to="/auth">{t("nav.signin")}</Link>
          </li>
          <li>
            <button
              type="button"
              onClick={cycle}
              className="rounded border border-border px-2 py-1 font-mono text-xs uppercase"
              aria-label={t("nav.cycleLanguage")}
            >
              {i18n.language.toUpperCase()}
            </button>
          </li>
        </ul>
      </nav>
    </header>
  );
}

function Loader() {
  return (
    <div className="container mx-auto py-12 text-muted-foreground">Loading…</div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main>
        <Suspense fallback={<Loader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/account" element={<Account />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/checkout/*" element={<Checkout />} />
            <Route path="/ops/*" element={<Ops />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
