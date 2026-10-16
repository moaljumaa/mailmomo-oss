# Self-hosting

## Docker (recommended)
```bash
git clone <this repo> && cd mailmomo
cp .env.example .env            # set BETTER_AUTH_URL=https://mail.example.com (+ optionally LLM_API_KEY)
docker compose up -d            # app on :3000 (+ Redis for multi-process live updates, optional)
```
Or pull the prebuilt image published on every release: `moaljumaa/mailmomo:latest` (Docker Hub, linux/amd64; also tagged per version).

Put it behind HTTPS (Caddy / nginx / Traefik); disable proxy buffering and allow long reads for `/api/events` (SSE).

## Rules of thumb
- Run **one** instance per `DATA_DIR` (SQLite + one IMAP connection per account).
- Back up `DATA_DIR` (`/data` in Docker): database, generated secrets, uploads. Never lose or change `MASTER_KEY` once accounts exist.
- The first account created becomes the owner; sign-up then closes (`ALLOW_SIGNUP=false`).
- Health check: `GET /api/health`.

## Secrets
Plain env vars, or set the `INFISICAL_*` bootstrap variables (see `.env.example`) and the container entrypoint fetches
everything else from [Infisical](https://infisical.com) at boot.

## AI
Set `LLM_API_KEY` (an Anthropic-compatible router such as Requesty) or `ANTHROPIC_API_KEY`. Pick the model in
**Settings → AI model & usage**, which also shows per-request cost. Everything works without a key, minus the AI features.
