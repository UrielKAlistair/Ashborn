#!/usr/bin/env bash
# One-time setup of instant push: gives the push Edge Function the Firebase key and a shared secret,
# and stores the function's address and that secret in the database's Vault for the trigger.
#   scripts/push-setup.sh <path to the Firebase service-account JSON key>
# Run from the repo root (it reads VITE_SUPABASE_URL from .env). Deletes the key file afterwards.
set -euo pipefail
key_file=$1
url=$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2-)
secret=$(openssl rand -hex 32)

npx supabase secrets set --yes FCM_SERVICE_ACCOUNT="$(cat "$key_file")" PUSH_SECRET="$secret"
npx supabase db query --remote --yes "
  select vault.create_secret('$secret', 'push_secret', 'Shared secret for the push Edge Function');
  select vault.create_secret('$url/functions/v1/push', 'push_url', 'The push Edge Function');" > /dev/null
rm "$key_file"
echo "Done: secrets set, Vault holds push_url and push_secret, key file deleted."
