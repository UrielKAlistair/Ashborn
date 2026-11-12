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
# Creates each Vault secret, or replaces its value when an earlier run made it
npx supabase db query --remote --yes "
  do \$\$
  declare s record;
  begin
    for s in select * from (values
      ('push_secret', '$secret', 'Shared secret for the push Edge Function'),
      ('push_url', '$url/functions/v1/push', 'The push Edge Function')) as v(name, value, description)
    loop
      if exists (select 1 from vault.secrets where name = s.name) then
        perform vault.update_secret((select id from vault.secrets where name = s.name), s.value);
      else
        perform vault.create_secret(s.value, s.name, s.description);
      end if;
    end loop;
  end \$\$;" > /dev/null
rm "$key_file"
echo "Done: secrets set, Vault holds push_url and push_secret, key file deleted."
