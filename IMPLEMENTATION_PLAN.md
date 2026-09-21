# SignCraft implementation plan and session handoff

## Start here

This plan records the decisions agreed with the user on September 19, 2026. Implementation has **not** started. The workspace contains the original specification in Markdown and DOCX. Read `SignCraft_Task_Specification.md` alongside this plan.

The user intends to install MCP servers before starting a new implementation session. Discover the tools available in that session. Use relevant connectors where available; do not assume any particular MCP server is installed or require one when ordinary development tools suffice.

Suggested prompt for the new session:

> Read IMPLEMENTATION_PLAN.md and SignCraft_Task_Specification.md, then implement the agreed application. First inspect the workspace and available MCP tools. Preserve the decisions in the plan, verify current package compatibility, and begin with the deployment/integration feasibility checks. Ask me for missing service configuration when needed, but continue independent implementation work. Do not invent credentials or claim deployment/integration success without verification. Keep this plan's checklist updated and document any necessary deviations.

## 1. Agreed decisions

| Area | Decision |
| --- | --- |
| Target | Focused, polished interview assignment, estimated 3–5 development days |
| Framework | Next.js App Router and TypeScript |
| UI | MUI components plus Tailwind for layout |
| Database | User-provided MongoDB Atlas URI, Prisma ORM |
| Storage | Cloudflare R2, real uploads only |
| Hosting | Vercel, free-tier hosting |
| Authentication | Real login for seeded accounts, server-enforced roles, no signup |
| Workflow | Manager creates/selects vendor; vendor advances production; installers claim and complete jobs |
| Verification | Manager approval stands in for installer identity/payment verification |
| Live updates | SSE backed by MongoDB change streams; QStash for delayed expiry callbacks |
| Upload progress | Byte percentage in uploading browser only; live status changes for other authorized viewers |
| Upload gate | At least one completed file before production begins |
| Layout | Searchable orders table, detail drawer, mobile cards |

Chosen defaults: English light-theme dashboard; one manager, two vendors, three installers; 2 GiB maximum per file; manager-only uploads before production; part retries but no resume after closing the browser.

No real payment provider, identity provider, vendor bidding, signup, password reset, or vendor/installer management CRUD in this version.

## 2. Architecture

- Next.js Node.js route handlers contain the backend APIs and event processing. Keep domain rules in testable services, separate from route parsing and UI rendering.
- Use MUI components with its Next.js SSR integration; use Tailwind for layout. Configure style ordering deliberately to avoid conflicting resets.
- React Hook Form and Zod handle forms and shared validation. TanStack Query manages client data and invalidation.
- Auth.js credentials login checks hashed seeded passwords; JWT sessions identify users. Every API and event stream enforces roles and resource access. Use secure cookies, origin/CSRF protection for mutations, and bounded login attempts.
- Use Prisma for application persistence. The proposed compatible baseline is Prisma 6.19 for MongoDB; verify its support/security status and current MongoDB-compatible alternatives before installing, and pin matching CLI/client versions. Do not blindly install a major without MongoDB support.
- Use the native MongoDB driver only for change streams. Reuse bounded clients/pools per runtime instance, not new clients for every query.
- Private R2 bucket stores file bytes; Atlas stores asset metadata. Use the AWS S3 SDK against the R2 endpoint.
- QStash delivers delayed, signed requests to a Next.js expiry route. MongoDB remains authoritative for claim ownership and deadlines.
- Vercel hosts the application. Dockerfile and Docker Compose provide local container execution against configured external services.

## 3. Product workflow

The only forward order transitions are:

```text
DRAFT → SUBMITTED → VENDOR_ACCEPTED → IN_PRODUCTION
      → READY_FOR_INSTALL → COMPLETED
```

Cancellation is permitted only from DRAFT, SUBMITTED, or VENDOR_ACCEPTED. COMPLETED and CANCELLED are terminal. The same transition definition powers frontend available actions and backend enforcement; direct API requests cannot bypass it.

| Action | Actor | Conditions |
| --- | --- | --- |
| Create/edit draft | Manager | Business fields editable while DRAFT |
| Upload files | Manager | Nonterminal order before IN_PRODUCTION |
| Select vendor and submit | Manager | Required fields and vendor present; vendor fixed after submission |
| Accept order | Selected vendor | SUBMITTED |
| Start production | Selected vendor | VENDOR_ACCEPTED and at least one completed asset |
| Mark ready | Selected vendor | IN_PRODUCTION |
| Claim job | Installer | READY_FOR_INSTALL and no active pending claim or confirmed assignment |
| Approve/reject claim | Manager | Matching pending claim, before its deadline |
| Complete installation | Confirmed installer | READY_FOR_INSTALL and assigned to that installer |
| Cancel | Manager | Before production |

Manager approval is explicitly labeled as the assignment's stand-in for identity/payment verification. Approval does not advance order production status. Rejection releases the job immediately. Expiry also releases the job without moving production status backward.

Order fields: title, customer business, contact name/email, signage description, positive quantity, installation address, requested installation date, optional notes, selected vendor. Store requested dates as date-only business values and deadlines/timestamps as UTC instants.

Manager sees all orders. Vendors see their assigned orders and files. Installers see available jobs and their own claimed/assigned jobs. Marketplace responses and events expose installation details but not private customer contacts or print-file access.

Dashboard: role-scoped summary counts, search, status filters, pagination, desktop/tablet table, mobile cards. Detail drawer includes business details, history, assets, vendor, and installer status. Add creation, transition confirmation, claim, and approval/rejection dialogs. Include upload progress, deadline countdown, connection state, loading/empty/error states, accessible controls, and keyboard/focus behavior.

## 4. Data and interfaces

Primary records:

- **User:** unique email, name, password hash, role.
- **Order:** business fields, creator, vendor, status, integer revision, current claim ID, installer ID, claim state, expiry, timestamps.
- **Asset:** order/uploader IDs, unique R2 object key, original filename, declared/verified size, content type, multipart upload ID, upload state, timestamps.
- **OrderEvent:** order ID, revision, actor, event type, timestamp, sanitized details and visibility information.

Keep current assignment state on the order document so acquisition is a single conditional atomic update. Use claim states NONE, PENDING, APPROVED; history records rejection/expiry/replacement. Index role-scoped order lists, pending deadlines, assets by order, and events by order/time. Use database transactions for successful state changes plus history events, with bounded retry on transient write conflicts. Never make external QStash/R2 calls inside a database transaction.

| API | Purpose |
| --- | --- |
| `/api/auth/*` | Login, logout, session |
| `/api/orders`, `/api/orders/:id` | Scoped listing, creation, details, draft edits |
| `/api/orders/:id/transition` | Validated lifecycle transition |
| `/api/orders/:id/claim` | Atomic installer reservation |
| `/api/orders/:id/claim/decision` | Manager approval/rejection |
| `/api/uploads/*` | Initiate, sign parts, complete, abort, authorized download |
| `/api/events` | Authenticated SSE |
| `/api/jobs/expire-claim` | Signature-verified QStash callback |

Use Zod request validation and structured errors. Invalid lifecycle transitions/input return HTTP 400; authentication/access errors use 401/403; conflicting reservations/stale revisions use 409. Scope lookups before returning sensitive records. Mutations include the relevant revision or claim ID to prevent stale actions.

## 5. Atomic claims and expiry

1. Validate actor and job eligibility. Generate a unique claim ID and server deadline of 180 seconds.
2. Schedule a QStash callback for this claim/deadline before attempting the reservation. If scheduling fails, do not acquire a claim. If too little deadline time remains after scheduling, fail/retry instead of accepting an already expired claim.
3. Atomically update the order only if it is READY_FOR_INSTALL and either unclaimed or has an expired PENDING claim; never replace APPROVED assignments. Match the expected revision and increment it. Record the event transactionally.
4. Exactly one simultaneous contender succeeds. Losers return 409 and current safe job state. Callbacks scheduled for losing claim IDs become harmless no-ops.
5. Approval checks matching claim ID, PENDING state, and server time strictly before expiry. Rejection uses the same identity/state guards.
6. The callback verifies the QStash signature and clears only the matching expired PENDING claim. Duplicate callbacks, old callbacks, and callbacks after approval are idempotent no-ops. A prematurely delivered callback must be retried, not consume the only expiry action.
7. Reads and claims interpret expired PENDING reservations as available even if callback delivery is late. A client countdown performs one reconciliation fetch at expiry; it never authorizes a claim or approval.
8. A subsequent claim may atomically replace an expired reservation; record the old expiry in history as part of that mutation. Do not let an old callback clear the replacement.

Do not use in-memory locks, process timers, MongoDB TTL deletion, or browser timers as the correctness mechanism. QStash provides durable delivery, but availability after the deadline depends on the database predicate, not delivery precision.

## 6. R2 uploads

- Allow real files up to 2 GiB. Treat content as untrusted; use attachment downloads rather than inline execution. Do not introduce arbitrary file restrictions beyond the documented size policy.
- Authenticate and authorize initiation. Generate server-owned object keys, record the asset, and create the multipart upload with compensation on partial failure.
- Upload 16 MiB parts directly from browser to R2, at most three concurrent parts. Use XMLHttpRequest progress and aggregate unique part progress correctly across retries.
- Issue short-lived signed part URLs in bounded batches. Retry failed parts up to three times with backoff and obtain fresh URLs after expiry.
- Server validates upload ownership and parts, completes the multipart upload, verifies object metadata, then persists COMPLETED. Do not trust a client-side completion flag.
- Make completion retry-safe when R2 completion succeeds but the database write or API response fails. Reconcile using the server-owned key and stored upload identity.
- Provide cancellation/abort and restart. No persisted resume after browser closure. Abandoned uploads are cleaned up using R2 multipart lifecycle configuration; reconcile stale asset status without periodic progress polling.
- No binary payloads flow through Next.js or MongoDB. Only start/completion/failure lifecycle changes are persisted/broadcast; percentage remains in the uploading browser.
- Configure exact localhost/production origins, allowed methods/headers, and exposed ETag headers in R2 CORS. Keep credentials server-only and the bucket private. Authorized downloads receive short-lived signed URLs.
- Require a completed asset to enter production. Finish/abort handling must account for cancellation or other order changes while an upload is in flight.

## 7. Live updates and Vercel constraints

- Watch committed OrderEvent changes with MongoDB change streams; do not periodically poll the database for dashboard updates or upload percentages.
- Open the change stream before reporting SSE readiness, then fetch the current authorized snapshot. Buffer/coalesce incoming invalidations during snapshot fetch so startup and reconnection cannot lose updates.
- Events carry minimal authorized identifiers/revisions and trigger coalesced TanStack Query invalidations. Do not stream whole MongoDB documents or use client filters as access control.
- Send heartbeats; close streams before the configured Vercel execution timeout; reconnect with backoff and refresh a snapshot after reconnect. Release cursors/listeners on disconnect and stop retry storms during failures.
- Reauthorize each stream connection and outgoing event. Ensure changes affecting visibility remove stale items from client views.
- Display connection problems and allow manual refresh. Do not silently fall back to repeated database polling.
- Verify SSE streaming, headers, function duration, MongoDB connection usage, and reconnect behavior in an early Vercel deployment. Free-tier resource budgets constrain concurrent demo users.
- Vercel Hobby daily cron is insufficient for three-minute expiry; use QStash. Verify current provider limits during setup rather than relying on historical numbers.

## 8. Build sequence and checklist

### Stage 1 — Foundation and feasibility (day 1)

- [ ] Inspect installed tools/MCP servers, runtime, repository state, and relevant workspace instructions.
- [ ] Verify compatible package versions; scaffold Next.js, MUI/Tailwind, validation, tests, and environment configuration.
- [ ] Define schema/indexes, authentication, role checks, and idempotent seeds.
- [ ] Add Dockerfile/Compose and an isolated replica-set MongoDB test environment.
- [ ] Deploy a minimal application to Vercel and verify Atlas, SSE/reconnect, R2/CORS, and signed QStash callbacks.
- [ ] Record any necessary compatibility deviations before expanding implementation.

### Stage 2 — Orders and dashboard (day 2)

- [ ] Implement order APIs, shared lifecycle rules, role-scoped queries, and transactional history.
- [ ] Implement responsive dashboard, creation, filters, detail drawer, state dialogs, and cancellation.

### Stage 3 — Installer claims (day 3)

- [ ] Implement atomic claims, approval/rejection, callback delivery, idempotency, expiry read semantics, and countdowns.
- [ ] Prove concurrency and deadline behavior with integration tests.

### Stage 4 — Uploads and live integration (day 4)

- [ ] Implement multipart upload, real progress, part retries, URL refresh, completion reconciliation, and abort.
- [ ] Wire committed events into authorized SSE updates and cross-session cache refreshes.
- [ ] Verify a real 1GB+ upload and production asset gating.

### Stage 5 — Submission readiness (day 5)

- [ ] Finish responsive/accessibility/error-state polish.
- [ ] Run lint, type checks, domain/integration tests, browser tests, and production build.
- [ ] Smoke-test the deployed application and rehearse reviewer flows.
- [ ] Finish README, configuration instructions, schema/architecture documentation, reviewer accounts, and demo script.
- [ ] Deliver repository and verified live deployment links.

## 9. Acceptance tests

Use Vitest for domain/integration tests and Playwright for critical browser flows. Database concurrency tests must use a real isolated MongoDB replica set, not mocks. Keep tests out of the user's production data.

- All permitted transitions succeed; skipped/backward/terminal transitions and late cancellation return 400.
- Production requires a completed asset, not merely initiated or in-flight upload metadata.
- Unauthorized roles cannot mutate or read protected data through direct APIs, downloads, or SSE.
- Twenty concurrent installers produce exactly one successful claim.
- Concurrent approval/expiry has one valid outcome; an expired claim cannot be revived.
- Duplicate/old callbacks cannot clear a newer or approved assignment.
- A new installer can claim an expired reservation even when QStash is delayed.
- Scheduling failure leaves no acquired reservation; a callback for an unsuccessful claim is harmless.
- Independent application instances obey the same locking rules.
- Upload progress reflects real bytes; failed parts retry without exceeding bounds; cancellation aborts work.
- Oversize/foreign uploads are rejected; forged completion cannot mark an absent object complete.
- R2 success followed by database failure can be reconciled by retrying completion.
- Manually verify a real 1GB+ upload and confirm file bytes bypass application routes.
- Two browser sessions receive committed changes, respect role visibility, and recover after SSE disconnects.
- No periodic dashboard/upload-progress database polling exists.
- Login, end-to-end order fulfillment, and responsive mobile/tablet/desktop flows work in the deployed application.

CI runs lint, type checking, meaningful domain/integration tests, and production build. Browser and external-service tests use dedicated environments; document separately which checks require credentials. Log request IDs, conflicts, callback failures, stream failures, and upload failures without secrets, passwords, signed URLs, or unnecessary customer data.

## 10. Configuration and handoff requirements

Request these during implementation when needed; continue independent work while configuration is pending:

- MongoDB Atlas URI and dedicated database name; deployment network access configured for Atlas.
- R2 account ID, bucket name, scoped S3 access key ID/secret, and CORS/lifecycle setup access.
- QStash token, current/next signing keys, and deployed callback base URL.
- Authentication secret and seeded-account credentials.
- GitHub repository and Vercel project access through tools/CLI or user-assisted setup.

Credentials belong in local ignored environment files and deployment secret settings, never committed files or logs. Supply a placeholder-only `.env.example`. Use separate test data and object prefixes. Do not automatically reset production data. Seed commands should be repeatable and nondestructive by default.

Docker Compose runs the Next.js application against configured Atlas/R2 services; provide a separate local replica-set database for tests. QStash local callback verification requires a reachable development endpoint; unit/integration tests can invoke the verified handler through a controlled test harness without weakening production signature checks.

Deliver a README covering setup, schema, roles, atomic locking, deadlines and delayed callbacks, R2 pipeline, SSE/reconnection, test commands, container execution, deployment configuration, free-tier limitations, and known scope boundaries. Include a demo script covering normal fulfillment, competing claims, rejection/expiry, invalid transitions, and real upload progress.

Expected final artifacts: complete source repository, Dockerfile, Docker Compose, environment example, seeds, tests, README, and a working Vercel URL. Report any credentials-dependent work still blocked truthfully; do not mark external integrations verified without running them.

## Reference documentation

Verify current versions and limits when implementation begins:

- Prisma MongoDB/version guidance: https://www.prisma.io/docs/orm/v6/more/upgrades/to-v7
- Auth.js credentials: https://authjs.dev/getting-started/providers/credentials
- MongoDB change streams: https://www.mongodb.com/docs/manual/changestreams/
- Atlas free-tier limits: https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/
- R2 pre-signed URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- R2 CORS: https://developers.cloudflare.com/r2/buckets/cors/
- R2 upload limits: https://developers.cloudflare.com/r2/platform/limits/
- QStash delayed delivery: https://upstash.com/docs/qstash/features/delay
- QStash free-plan pricing: https://upstash.com/pricing/qstash
- Vercel function limits: https://vercel.com/docs/functions/limitations
- Vercel cron limits: https://vercel.com/docs/cron-jobs/usage-and-pricing
