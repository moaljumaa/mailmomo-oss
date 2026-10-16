#!/bin/sh
# Fetches runtime secrets from self-hosted Infisical at boot. Only the INFISICAL_* bootstrap
# vars live on disk (.env.local). Without them (local docker compose) it just runs the command.
set -e
if [ -n "$INFISICAL_UNIVERSAL_AUTH_CLIENT_ID" ]; then
  TOKEN=$(infisical login --method=universal-auth \
    --client-id="$INFISICAL_UNIVERSAL_AUTH_CLIENT_ID" \
    --client-secret="$INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET" \
    --domain="$INFISICAL_API_URL" --plain --silent)
  exec infisical run --token="$TOKEN" --projectId="$INFISICAL_PROJECT_ID" \
    --env="$INFISICAL_ENV" --domain="$INFISICAL_API_URL" -- "$@"
fi
exec "$@"
