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
- Atlas and Vercel deployment were explicitly authorized and verified on 2026-09-21. Production URL: https://signcraft-operations.vercel.app. The private GitHub `main` branch is connected to Vercel.
- Verification completes synchronously on the server; the UI shows a pending request. Identity must pass before payment. Demo failure is opt-in via `DEMO_MODE=true`.
- Installers may reserve multiple jobs. Each job has at most one owner; there is no per-installer capacity constraint in this version.
- Optional manager overrides, ranking, and the concurrency demo button are omitted. Managers can edit drafts and cancel eligible orders; normal state transitions cannot be bypassed.
- SSE connections rotate at 50 seconds for bounded function lifetime. Hosted Manager and Vendor sessions received completion updates without manual refresh; both reconnected successfully. A quiet 20-second observation and source review confirmed no interval-based database polling fallback. Verification is at demo scale; sustained load is untested.

## Remaining external checks

- Real R2 large upload, CORS and signed download.
- Docker execution (Docker is not installed on this workstation).

## Executed cloud verification (2026-09-21)

- Atlas: dedicated `signcraft_operations` database; replica set, connectivity and read transaction verified; schema/index push and additive seed succeeded. Six demo accounts and their bcrypt password hashes were verified. Local database data and configuration were preserved.
- Vercel: Next.js / Node 24, production build passed, public HTTPS login page reachable. All six required production variables configured, including a generated authentication secret. Preview/development do not receive the production database URL. R2 variables are absent and upload mode is simulation.
- Five hosted Playwright tests passed: read-only dashboard login/reload; complete Manager/Vendor/Installer workflow with simulated upload, countdown change, both verifications, completion and event history; unauthenticated API/SSE rejection; cross-session SSE rotation/reconnect without polling; and 20 concurrent claims across three installers with one 200 and nineteen 409 responses. The race winner was released with demo failure; the workflow order remains as fictional verification history.
- Existing Manager and Vendor browser sessions observed completion without manual refresh. Desktop/mobile layout checks passed without browser page errors.
- TypeScript and ESLint passed; 54 unit tests and eight isolated real-MongoDB integration tests passed. Integration tests did not use or reset Atlas.
- Initial runtime failures were traced to Atlas network restrictions and stale Prisma topology after the network change. A fresh deployment cleared these failures; production verification then passed.
- Runtime review after the passing tests inspected 200 request entries, including nine SSE entries, with no error/warning entries or HTTP 5xx responses. Build logs showed no build failure; dependency install-script and broad Node-engine-range notices remain informational.
- Atlas uses an assignment-project `0.0.0.0/0` network entry for Vercel Hobby's dynamic egress. Authentication is still required; fixed egress and a restricted allowlist are recommended for deployment beyond this isolated demo.
- Secrets, `.env*` files other than `.env.example`, `.local/`, `.vercel/`, dependencies, build output, and runtime/test artifacts remain excluded from Git. CLI deployment has explicit artifact/secret exclusions in `.vercelignore`.

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
