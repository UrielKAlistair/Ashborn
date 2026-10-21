# Electron + React + Typescript

Ashborn is a desktop app built with Electron, React, Typescript, and Vite.

## Setup

1. `npm install`
2. Create a [Supabase](https://supabase.com) project, copy `.env.example` to `.env`, and fill in
   the project URL and publishable key (Project Settings → API keys).
3. Apply the schema: `npx supabase login`, `npx supabase link --project-ref <ref>`,
   `npx supabase db push`.
4. Create your account in the Supabase dashboard (Authentication → Users → Add user, with "Auto
   Confirm User"), then `npm run electron:dev` and sign in.

`npm test` runs the tests; the end-to-end ones run as a separate test user: create one in the
Supabase dashboard (Authentication → Users, with "Auto Confirm User") and add `E2E_EMAIL` and
`E2E_PASSWORD` to `.env`.

## Accounts

Sign-ups are closed (Authentication → Sign In / Providers): Ashborn is invite-only. To give
someone access, Authentication → Users → Add user, with a password and "Auto Confirm User", and
tell them the password. (The dashboard's invite and recovery emails are links to a web page,
which Ashborn does not have.)

There is no "Forgot password" in the app. To set a new password by hand, run this in the
dashboard's SQL Editor; only the password changes, and the account's data is untouched:

```sql
update auth.users
set encrypted_password = crypt('new-password', gen_salt('bf'))
where email = 'you@example.com';
```

## Desktop app (Linux)

- `npm run appimage` builds `release/Ashborn.AppImage` (the Supabase URL and publishable key
  from `.env` are built in).
- `scripts/install-appimage.sh` copies it to `~/Applications/Ashborn.AppImage` and makes it
  start at login, hidden in the tray (`~/.config/autostart/ashborn.desktop`). To remove it,
  delete the AppImage: the login entry is skipped once its file is gone.

It shares the dev app's data folder (`~/.config/ashborn`), so the two cannot run at once: a
second start only brings the running window forward.

## Android app

The phone app is the same web app packaged with Capacitor (`android/`), plus a native alarm.
Building needs a JDK 21 (`JAVA_HOME`, or `~/Android/jdk-21`) and the Android SDK packages
`platform-tools`, `platforms;android-36` and `build-tools;35.0.0` in `~/Android/Sdk`.

The app is a release build, signed with your own key, which stays outside the repository. Once:

1. Make the key: `keytool -genkeypair -keystore ~/.config/ashborn/release.keystore -alias ashborn
   -keyalg RSA -keysize 4096 -validity 10000` (keytool comes with the JDK). Keep a copy of the
   file and its password somewhere safe: updates must be signed with the same key.
2. Add to `~/.gradle/gradle.properties`:
   ```
   ASHBORN_KEYSTORE=~/.config/ashborn/release.keystore
   ASHBORN_KEYSTORE_PASSWORD=...
   ASHBORN_KEY_ALIAS=ashborn
   ASHBORN_KEY_PASSWORD=...
   ```

- `npm run android:build` builds `android/app/build/outputs/apk/release/app-release.apk`.
- `npm run android:install` builds it and installs it on a phone connected by USB (with USB
  debugging on). A phone holding an earlier debug build needs that app uninstalled first, since
  the two are signed with different keys; let it sync first, as uninstalling clears changes still
  waiting to be sent.

On first start the app asks to allow notifications and, on Android 14+, to show alarms over
the lock screen; both are needed for alarms to ring.

## Agent access (MCP)

Ashborn includes an MCP server, so an agent such as Claude Code can read and edit your
quests, steps, links, routines and deadlines ("I'm learning deep learning, roughly these
ideas, plan it for me"). Changes show up live in the app.

1. `npm run agent:login` once, with your Ashborn email and password. The session is kept in
   `~/.config/ashborn/agent-session.json`, readable only by you.
2. In this folder, Claude Code picks the server up from `.mcp.json` (approve it when asked).
   To use it from anywhere:
   `claude mcp add --scope user ashborn -- npm --prefix /path/to/Ashborn run -s agent`

Tools: `overview`, `add_plan` (nested, linked steps in one call), `complete`, `reopen`,
`rename`, `move`, `delete`, `link`, `unlink`, `level_up`, `update_quest` (stat weights, colour,
shown), `add_deadline`, `add_routine`, `add_alarm`.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/)

## Credits

- Alarms icon: "alarm-clock" from [Lucide](https://lucide.dev), licensed [ISC](https://lucide.dev/license).
- Treasury icon: "Open treasure chest" by Skoll, from [game-icons.net](https://game-icons.net), licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
