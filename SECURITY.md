# Security policy

Thanks for taking the time to keep Dishine Convert secure.

## Supported versions

We patch security issues against the `main` branch and the most recently tagged release. Forks and self-hosted deployments should rebase regularly.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Email **`security@dishine.it`** with:

- A clear description of the issue
- Steps to reproduce (if possible, a minimal PoC)
- Your assessment of impact (what an attacker could access or break)
- Whether you'd like public credit in the advisory

We aim to:

- Acknowledge your report within **48 hours**
- Provide a remediation timeline within **7 days**
- Ship a fix and disclose coordinated details once users have had reasonable time to upgrade

## Scope

In-scope examples:

- RLS bypass — reading or writing another user's data (`usage_log`, `api_keys`, `subscriptions`)
- Quota enforcement bypass or forged authentication
- API-key or secret extraction from server logs, responses, or DB dumps
- Edge-function injection or SSRF through the URL fetcher
- XSS / template injection in the front-end
- Supply-chain risks in `package.json` / `deno.json`

Out-of-scope:

- DoS via volume (the edge platform handles rate limiting at the infrastructure level)
- Social engineering of maintainers
- Issues requiring physical or local access to a victim's device
- Self-XSS or "open redirect" on a feature that is clearly documented as opening a user-controlled URL

## Safe-harbor

If you're making a good-faith effort to find and report issues responsibly, we will not pursue legal action.

## Data model

- **Files are never persisted.** They pass through edge-function memory and are discarded immediately after conversion.
- **Raw IPs are never stored.** Only a salted one-way hash at subnet granularity is recorded for rate-limiting purposes.
- **API-key secrets are never stored.** Only a SHA-256 hash is kept; the raw secret is shown once on creation and cannot be recovered.
- **Stripe** handles all payment data. The app never sees card numbers.

## Contact

- Email: `security@dishine.it`
- Maintainers: listed in [CODEOWNERS](.github/CODEOWNERS) (when present)
