# `public/` — static assets

Vite serves this directory at the root. Two binary assets live here in the
deployed site but are **not** committed to the public repository (for file-size
and licensing hygiene):

- `favicon-logo.png` — 512×512 square, transparent PNG, used for favicon + PWA icon.
- `og-image.webp` — 1200×630 Open Graph card.

If you're self-hosting, drop your own copies at those paths before building.
Placeholder references are already in `index.html` and `site.webmanifest`.

Everything else here (`robots.txt`, `site.webmanifest`) is plain text and lives
in git.
