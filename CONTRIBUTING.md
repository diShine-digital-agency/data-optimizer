# Contributing

Thanks for wanting to make Dishine Convert better! This doc explains how to get a PR merged quickly.

## Table of contents

- [Ground rules](#ground-rules)
- [Dev setup](#dev-setup)
- [Project layout](#project-layout)
- [Coding conventions](#coding-conventions)
- [Commit & PR conventions](#commit--pr-conventions)
- [Testing](#testing)
- [Translations](#translations)
- [Reporting bugs](#reporting-bugs)

---

## Ground rules

- Be kind. We follow the [Contributor Covenant](CODE_OF_CONDUCT.md).
- Open an issue before writing a large PR — we'll happily discuss scope and approach before you invest hours.
- Small, focused PRs beat sprawling ones. If your change touches three subsystems, split it.
- Every new user-facing string needs EN/IT/FR translations (see [Translations](#translations)).

---

## Dev setup

```bash
git clone https://github.com/<you>/dishine-convert.git
cd dishine-convert
pnpm install
cp .env.example .env     # fill in VITE_SUPABASE_* + GEMINI_API_KEY
pnpm dev                 # http://localhost:5173
```

For the backend side:

```bash
supabase start                                  # local Supabase stack
supabase functions serve --no-verify-jwt        # edge functions on :54321
```

---

## Project layout

```
src/                   React SPA
supabase/
  migrations/          SQL schema
  functions/           Deno edge functions
    _shared/           shared helpers (admin-token, api-key, rate-limit)
docs/                  OpenAPI spec + diagrams
_wiki-pages/           trilingual long-form docs
```

See [`TECHNICAL.md`](TECHNICAL.md) for a deeper architectural tour.

---

## Coding conventions

- **TypeScript strict** mode is on. Don't add `// @ts-expect-error` unless you also add a comment explaining why.
- **Prettier** + **ESLint** — run `pnpm lint` before committing. CI will reject unformatted code.
- **Imports**: named imports, absolute paths via `@/*`. No default exports for components.
- **React**: function components only. Prefer Server-free state (URL + TanStack Query).
- **Tailwind**: keep utility classes on the element — don't extract into a `clsx` helper unless it's reused 3+ times.
- **Edge functions**: no npm packages outside the allow-list (`@supabase/supabase-js` only). The bundle has to stay small; we do our own ZIP decoding on purpose.
- **No `any`**. Use `unknown` + narrowing, or write a proper type.

---

## Commit & PR conventions

We use **Conventional Commits**:

```
feat(convert-file): add EPUB extractor
fix(pptx): handle slides without layout refs
docs(readme): clarify Free quota rules
chore(deps): bump supabase-js to 2.45
refactor(api-key): split parsing helper
test(rate-limit): cover the 60s window rollover
```

**PR checklist:**

- [ ] Linked to an issue (or explains why none is needed)
- [ ] `pnpm lint && pnpm typecheck && pnpm test` all pass locally
- [ ] New user-facing copy translated to EN/IT/FR
- [ ] Screenshot(s) for UI changes
- [ ] No secrets, `.env` files, or prod URLs committed

PRs need one maintainer review. We aim to respond within 3 business days.

---

## Testing

- **Unit**: `pnpm test` (Vitest).
- **Edge functions**: `pnpm test:functions` (Deno test) — run against the local Supabase.
- **E2E**: `pnpm e2e` (Playwright). Requires local Supabase + front-end running.

Adding a new file format or model router? Add a fixture file under `supabase/functions/convert-file/__fixtures__/` and a corresponding test in `convert-file.test.ts`.

---

## Translations

Every user-facing string lives in `src/i18n/{en,it,fr}.json`. Workflow:

1. Add the key to `en.json` first with the final English copy.
2. Run `pnpm i18n:check` — it flags missing keys in `it.json` / `fr.json`.
3. Fill in native translations. If you're not a native speaker, add `// FIXME: needs native review` — a maintainer will flag it for follow-up.
4. Use ICU message syntax for plurals & variables: `"quota.remaining": "{count, plural, one {# conversion left} other {# conversions left}}"`.

Adding a whole new locale? Open an issue first so we can wire up the selector and routing.

---

## Reporting bugs

- **Security issues** → **DO NOT** open a public issue. Email `security@dishine.it` — see [`SECURITY.md`](SECURITY.md).
- **Everything else** → open a GitHub issue using the "Bug report" template. Include:
  - Steps to reproduce (ideally a minimal file / URL)
  - What you expected vs what happened
  - Browser / OS / tier (Free / Pro / self-hosted)
  - Any error shown in the UI or browser console

Thanks for contributing. ✨
