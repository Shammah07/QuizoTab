<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


# QuizoTab Project Instructions

## Context and Scope

QuizoTab is a Tanzania-focused platform for
interactive live quizzes and professional
multi-room tournament management.

Before planning or modifying tournament workflows,
read these project documents:

- QUIZOTAB_CODEX_HANDOFF.md
- QuizoTab_Technical_Development_Blueprint.md

Verify the documents against the actual codebase.

## Technology Stack

Preserve the existing architecture:

- Next.js
- React
- TypeScript
- Drizzle ORM
- Neon PostgreSQL
- Tailwind CSS
- Vercel

Follow the Next.js version-specific instructions above.

## Development Principles

1. Preserve existing working functionality.
2. Prefer incremental improvements over rewrites.
3. Inspect relevant files before making changes.
4. Maintain compatibility with existing database records.
5. Prioritize reliability, performance, and security.
6. Enforce authentication and authorization on the server.
7. Write tests for new functionality.
8. Avoid unnecessary dependencies.
9. Document significant architectural decisions.
10. Do not modify working features without justification.

## Database Safety

Never modify the production Neon database
without explicit permission.

Use a separate development database branch
when testing migrations.

Review generated SQL before applying migrations.

Do not delete production records.

## Tournament Security

Judges must only submit scores for their assigned rooms.

Room hosts must only approve scores for their
authorized rooms.

Pending scores must not appear in public standings.

Score submissions must be protected against
duplicate requests and concurrent updates.

Maintain audit records for:
- Score submissions
- Approvals
- Rejections
- Corrections

## Current Development Priority

Milestone 1:

Tournament administrator assigns rooms and staff.

Authorized judge submits a question-level score.

Score remains pending.

Assigned room host approves or rejects the score.

Approved scores update official standings.

Spectators see approved standings for their selected room.

## Development Workflow

Before modifying code:

1. Inspect the existing implementation.
2. Check Git status.
3. Identify affected files.
4. Establish a baseline using existing tests.
5. Explain risks and proposed changes.

After modifying code:

1. Run TypeScript checks.
2. Run lint checks.
3. Run relevant automated tests.
4. Run the production build.
5. Report remaining errors and risks.

## Commands

Use existing scripts from package.json:

npm run typecheck
npm run lint
npm test
npm run build

## Security Restrictions

Never expose or commit environment variables,
database credentials, API keys, or secrets.

Never run destructive database operations
without explicit authorization.

Do not run npm audit fix --force
without evaluating compatibility risks.

Do not automatically approve dependency
install scripts without reviewing them.