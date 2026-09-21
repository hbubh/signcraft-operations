# Implementation status and decisions

The supplied `IMPLEMENTATION_PLAN_FINAL1.md` is the design reference; the original SignCraft task remains the assignment specification. The existing `IMPLEMENTATION_PLAN.md` is preserved.

## Compatibility

- Next.js App Router, React, MUI, Tailwind, Zod, React Hook Form, TanStack Query, Auth.js credentials.
- Prisma CLI/client pinned together to 6.19.0, following the official MongoDB connector guidance. Do not upgrade to v7 without checking MongoDB support.
- Node 24 is used locally and in Docker. The machine-wide Node 18.17.1 is too old.
- Money is stored as integer USD cents; installation dates as validated `YYYY-MM-DD` strings; deadlines as UTC timestamps.

## Scope decisions

- Upload simulation is the default because no R2 configuration was supplied. It signs simulated part receipts and enforces the protocol, but cannot prove that file bytes exist: none are sent or stored. The UI says so. R2 multipart support is implemented separately and must be verified with provider credentials before claiming integration success.
- A local real MongoDB replica set can be launched with `scripts/local-db.ts` without Docker. Tests create separate isolated real MongoDB processes, not database mocks.
- Deployment feasibility cannot yet be verified: no Atlas/Vercel project configuration has been supplied. Local implementation continues independently. No cloud deployment or repository publication is implied by the document's embedded working instructions alone.
- Verification completes synchronously on the server; the UI shows a pending request. Identity must pass before payment. Demo failure is opt-in via `DEMO_MODE=true`.
- Installers may reserve multiple jobs. Each job has at most one owner; there is no per-installer capacity constraint in this version.
- Optional manager overrides, ranking, and the concurrency demo button are omitted. Managers can edit drafts and cancel eligible orders; normal state transitions cannot be bypassed.
- SSE connections rotate at 50 seconds for bounded function lifetime. Reconnect refreshes authoritative queries and uses backoff on errors. Hosted SSE behavior remains to be verified.

## Remaining external checks

- Real R2 large upload, CORS and signed download.
- Atlas connectivity and hosted Change Streams.
- Vercel deployment and cross-session reconnect.
- Docker execution (Docker is not installed on this workstation).

## Source repository

- Private GitHub repository: https://github.com/hbubh/signcraft-operations
- Source, schema, tests, scripts, public files, dependency lockfile, documentation, container configuration, and `.env.example` are included.
- `.env`, `.local/`, `node_modules/`, and `.next/` are excluded from version control and publication.

## Executed local verification

- TypeScript: passed.
- ESLint: passed with no warnings.
- Production build: passed.
- Vitest: 54 unit tests passed.
- MongoDB integration: 8 tests passed, including 20-way contention and two independent Node processes (one winner, 19 conflicts).
- Playwright: full manager-to-installer lifecycle passed, including simulated upload, desktop/mobile screenshots, no horizontal mobile overflow, and no browser page errors. Unauthenticated API/SSE rejection passed.
- Local SSE reached connected state; cross-session updates were exercised during the workflow.
- Authenticated HTTP concurrency: 20 requests across three installer accounts produced one 200 and nineteen 409 responses.
- Standalone startup and idempotent reseeding verified locally. The app is available at http://localhost:3000 while its local processes remain running.
- npm audit: four high advisories remain in Prisma CLI development dependencies (`effect`, `deepmerge-ts`, and their dependents); see README. No forced incompatible major upgrade was applied.
