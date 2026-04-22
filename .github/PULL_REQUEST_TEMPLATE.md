<!--
Thanks for the PR! A few things before you hit "Create":
- Small, focused PRs land faster than sprawling ones.
- Security issues: DO NOT open a PR — email security@dishine.it first.
-->

## Summary

<!-- What does this change and why? 1–3 sentences. -->

## Linked issue

<!-- Fixes #123 / Refs #456 — or "no issue, trivial fix" with a one-liner rationale. -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (users must take action)
- [ ] Docs / tooling only

## Scope

- [ ] Front-end (React SPA)
- [ ] Edge function — convert-file
- [ ] Edge function — fetch-url
- [ ] Edge function — ops-unlock
- [ ] DB schema / migrations
- [ ] API / OpenAPI spec
- [ ] Docs / wiki

## Checklist

- [ ] `pnpm lint && pnpm typecheck` pass locally
- [ ] `pnpm test` passes (and I added tests for new behaviour)
- [ ] Edge-function changes checked with `deno check`
- [ ] New user-facing copy is translated to EN / IT / FR
- [ ] No secrets, `.env` files, or production URLs committed
- [ ] Migration is idempotent and reversible (if touching SQL)
- [ ] Screenshot(s) attached for visible UI changes

## Notes for reviewers

<!-- Anything that deserves extra attention: tricky diffs, perf trade-offs, follow-up work. -->
