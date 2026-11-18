# QuizoTab (Next.js rebuild)

The new QuizoTab: React + Tailwind on the front, Next.js route handlers and server actions on the back,
Neon (Postgres) for data, hosted on Vercel. It replaces the PHP site in the parent folder, which keeps
running untouched until this one is finished.

## Run it on your computer

Needs Node.js 20.9 or newer and an internet connection the first time (the build downloads the fonts).

```bash
npm install
copy .env.example .env.local     # then fill in .env.local
npm run dev                      # http://localhost:3000
```

The landing page works without a database. Everything that stores data needs `DATABASE_URL`.

## Database

1. Create a project at neon.com and copy both connection strings into `.env.local`
   (`DATABASE_URL` = pooled, `DATABASE_URL_UNPOOLED` = direct).
2. Create the tables: `npm run db:migrate`
3. After changing `lib/db/schema.ts`: `npm run db:generate`, then `npm run db:migrate`.

## Checks

```bash
npm run typecheck
npm run lint
npm test          # accounts and the quiz backend, against a throwaway database inside the test
npm run build
```

Demo data: `npm run db:seed` fills the database in `.env.local` with two demo hosts, 13 quizzes across the
categories (11 public, 2 private), solo leaderboards on five of them, two tournaments with teams, and three
live games (one finished, one waiting in its lobby, one tournament game with its scores still to send).
Log in as `demo.host@quizotab.test` or `demo.school@quizotab.test` with the password `DemoPass-2026`.
Run it again whenever you like: it remakes everything the demo accounts own and never touches other accounts.
`npm run db:seed -- --reset` removes the demo accounts and all their data.

## Where things are

| Folder | What |
| --- | --- |
| `app/` | Pages and (later) API routes |
| `components/ui/` | Button, Input, Card, Alert, Modal |
| `components/site/` | Header, footer, logo, language switch, hero |
| `lib/db/` | Database tables (`schema.ts`) and connection |
| `lib/auth/` | Login cookie, password hashing, secret tokens |
| `lib/quiz/` | Quiz backend: rules, engine (live games), quizzes, solo play, categories, tournament link |
| `lib/api.ts` | Shared plumbing for the JSON routes |
| `lib/realtime.ts` | The "something changed" signal for live games |
| `lib/mail.ts` | Confirmation and reset emails |
| `lib/rate-limit.ts` | Limits on repeated attempts (wrong passwords, sign-ups) |
| `lib/i18n/` | English / Swahili. Pages are written in English; `messages/sw.json` holds the Swahili |
| `drizzle/` | Generated SQL migrations |
| `proxy.ts` | Handles `?lang=sw` / `?lang=en` (Next.js 16's name for middleware) |

## What is done

- Phase 1 (foundation): project, design system, landing page shell, database schema, core libraries.
- Phase 2, accounts: register (no email confirmation; new accounts log straight in), login, logout, forgot and reset password
  (`/register`, `/login`, `/verify`, `/forgot`, `/reset`).

- Landing page: hero, sample leaderboard, "what it can do for you" tabs, steps, contact.
- Policy pages: `/terms`, `/refund`, `/privacy`.

- Quiz backend (`app/api/`): a host's quizzes, public quizzes and solo play, live games by PIN,
  host controls, and sending a game's team scores to a tournament round.
- Quiz and play screens: `/quiz` (my quizzes, host live), `/quiz/new` and `/quiz/[id]/edit` (the editor),
  `/quiz/explore` (public quizzes), `/quiz/host/[id]` (the big screen), `/play` (join with a PIN, the
  player's phone) and `/play/solo/[id]` (play a public quiz alone). Adding pictures and videos to
  questions waits for file uploads (`MEDIA_HOSTS`); media already on a question is kept.

## API

Every route answers JSON; errors are `{ "error": "..." }` with a fitting status.

| Route | Method | Who | What |
| --- | --- | --- | --- |
| `/api/quizzes` | GET, POST | Host | List own quizzes, create one |
| `/api/quizzes/[id]` | GET, PUT, DELETE | Owner | Read (with answers), save, delete |
| `/api/quizzes/categories` | GET | Host | Categories to file a quiz under |
| `/api/quizzes/explore` | GET | Anyone | Public quizzes: `?category=&search=&sort=&limit=` |
| `/api/quizzes/[id]/solo` | GET, POST | Anyone | Quiz info and best scores; start a solo game |
| `/api/solo/answer` | POST | Solo token | Score one answer, get the next question |
| `/api/games/lookup` | POST | Anyone | Is there a live game for this PIN? |
| `/api/games/join` | POST | Anyone | Join with a nickname (or team); returns the player token |
| `/api/games/state` | POST | Player token | What the phone should show now |
| `/api/games/answer` | POST | Player token | Answer the current question |
| `/api/host/games` | POST | Host | Start a game from a quiz |
| `/api/host/games/[id]` | GET | Game owner | Big-screen state |
| `/api/host/games/[id]/advance` | POST | Game owner | `{ to: start, reveal, next or end }` |
| `/api/host/games/[id]/kick` | POST | Game owner | Remove a player |
| `/api/host/games/[id]/send-scores` | POST | Game owner | Send team results to the tournament round |
| `/api/host/tournaments` | GET | Host | Own tournaments and rounds |

Still to move over: the tournament host app (`/host`, a separate Next.js app in `../Quiz Web`), the
header drop-down menus, the "three screens" demo and the live-quiz walkthrough on the home page, and
file uploads for question pictures and videos.

## Notes

- This folder sits inside the XAMPP site, so `.htaccess` blocks Apache from serving its files.
- `Quiz Web/scripts/publish.mjs --live` copies every folder of the PHP site into the upload package.
  Add `"quizotab"` to its `skip` list before running it again, or this source code will be uploaded too.
- Before writing Next.js code, read the matching guide in `node_modules/next/dist/docs/`: version 16 differs
  from older versions (async `cookies()`/`params`, `proxy.ts`).
