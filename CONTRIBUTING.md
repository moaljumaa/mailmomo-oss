# Contributing

Thanks for helping! Mailmomo is deliberately small and calm — keep changes minimal and focused.

## Setup
```bash
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000
npm run check          # typecheck + lint + tests (run before opening a PR)
```
Integration/e2e tests need Dovecot (`apt install dovecot-imapd`; Linux/macOS/WSL). `npm run test:unit` runs without it.

## Guidelines
- All mail reads/writes go through `src/server/mail/service.ts`; the MCP server and the in-app agent share `src/server/tools.ts`.
- No new dependency or abstraction unless it clearly pays for itself. Match the surrounding style.
- Add or update a test for behaviour changes. Update `docs/` when you change behaviour.
- Never commit secrets or `.env*` files.

## Licensing of contributions
The project is AGPL-3.0 with a reserved commercial `ee/` directory (see `ee/README.md`). By submitting a pull request you
agree that your contribution is licensed under AGPL-3.0 and that the maintainer may also distribute it under a commercial
license (inbound = outbound + relicensing right). Sign your commits with `git commit -s` to confirm the
[Developer Certificate of Origin](https://developercertificate.org/).
