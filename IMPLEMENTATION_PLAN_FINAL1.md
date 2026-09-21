# SignCraft Operations — Implementation Plan and Codex Handoff

## 0. Purpose of this document

This document is the authoritative implementation handoff for the **SignCraft Operations** interview assignment.

The goal is to build a focused, polished, production-like full-stack application that satisfies the original SignCraft task specification while deliberately keeping scope controlled.

The application should feel like a real internal operations product, not a prototype. Every visible core action should work.

The implementation should prioritize:

1. Correct lifecycle enforcement.
2. Correct authorization.
3. Correct concurrent installer claiming.
4. Clear, production-like UI/UX.
5. Realistic direct-to-cloud upload architecture.
6. Live operational feedback.
7. Strong tests and documentation.
8. Reliable deployment.

Do not add unrelated marketplace features, client portals, billing systems, AI systems, chat, or broad CRUD modules unless they are necessary for the requirements below.

---

# 1. Product definition

## Product name

**SignCraft Operations**

## Product concept

A B2B signage operations dashboard used by internal operations staff, vendors, and installers to manage physical signage orders from creation through production and installation.

The product intentionally focuses on three operational roles:

- **Manager – מנהל תפעול**
- **Vendor – ספק ייצור**
- **Installer – מתקין**

There is no separate customer login in this version.

The customer exists as business data attached to the order.

This keeps the implementation focused on the original assignment's operational dashboard requirement.

---

# 2. Required technology stack

Use:

- **Next.js App Router – פריימוורק React בצד שרת ולקוח**
- **TypeScript – JavaScript עם טיפוסים**
- **MongoDB – מסד נתונים**
- **Prisma ORM – שכבת גישה למסד**
- **MUI – ספריית רכיבי ממשק**
- **Tailwind CSS – utility styling / עיצוב פריסה**
- **Zod – אימות סכמות וקלט**
- **React Hook Form – ניהול טפסים**
- **TanStack Query – ניהול server-state בצד לקוח**
- **Auth.js – Authentication / אימות משתמש**
- **Vitest – בדיקות יחידה ואינטגרציה**
- **Playwright – בדיקות browser / end-to-end**
- **Vercel – Deployment / פריסה**
- **Docker / Docker Compose – הרצה מקומית בקונטיינרים**

Preferred upload storage:

- **Cloudflare R2 – אחסון קבצים תואם S3**

Preferred live updates:

- **SSE – Server-Sent Events**
- backed by **MongoDB Change Streams** where practical.

Before installing Prisma, verify the current MongoDB-compatible Prisma version and pin matching CLI/client versions. Do not assume the latest major is MongoDB-compatible.

---

# 3. Scope decisions

## Included

- Real login for seeded users.
- Role-based authorization.
- Order creation and management.
- Order state-machine enforcement.
- Vendor assignment.
- Vendor production workflow.
- Multiple assets per order.
- Direct-to-cloud upload architecture.
- Upload progress and upload failure/retry UX.
- Installer marketplace.
- Atomic installer claim.
- 3-minute reservation deadline.
- Simulated identity verification.
- Simulated payment verification.
- Claim expiry and release.
- Order event/history log.
- Search, filtering, pagination.
- Responsive desktop/tablet/mobile UI.
- Live updates where practical.
- Clear error states.
- Tests.
- Dockerized local setup.
- README and architecture documentation.
- Live Vercel deployment.

## Explicitly excluded

- Customer/client login.
- Public marketplace.
- Vendor bidding.
- Real payment provider.
- Real identity verification provider.
- Signup/registration.
- Password reset.
- Vendor management CRUD.
- Installer management CRUD.
- Messaging/chat.
- AI recommendations.
- Full campaign management system.
- Multi-order campaign entity.
- Complex finance/accounting features.

---

# 4. Authentication and authorization

## Authentication

Use real credential-based login for seeded demo users.

Use:

- hashed passwords.
- secure sessions.
- secure cookies.
- server-side authorization.
- reasonable login-rate protection.
- safe error messages.

No public signup.

Seed demo accounts:

- 1 Manager
- 2 Vendors
- 3 Installers

Provide the demo credentials in the README.

## Roles

```ts
type Role = "MANAGER" | "VENDOR" | "INSTALLER"
```

## Authorization rules

### Manager

Can:

- view all orders.
- create orders.
- edit DRAFT orders.
- select/change vendor when allowed.
- upload assets.
- cancel eligible orders.
- view all order history.
- view all installation jobs.
- view all active reservations.
- correct/override operational states when explicitly supported by an admin-only action.
- resolve operational problems.
- access diagnostic demo tools where appropriate.

### Vendor

Can:

- view only orders assigned to that vendor.
- inspect order details and completed assets.
- accept SUBMITTED orders.
- move accepted orders into production only if at least one asset is completed.
- mark production complete and move the order to READY_FOR_INSTALL.
- view history related to their orders.

Cannot:

- access other vendors' orders.
- assign installers.
- claim installation jobs.
- modify unrelated customer/business data after submission.

### Installer

Can:

- view installation jobs that are AVAILABLE or logically available after expiry.
- see their own RESERVED/ASSIGNED jobs.
- claim a job.
- complete simulated verification.
- complete installation only if assigned to that job.

Cannot:

- change order production states.
- inspect protected customer contact data.
- access print files unless explicitly needed and authorized.
- claim more than allowed according to business rules defined below.

---

# 5. Core order lifecycle

The required order lifecycle is:

```text
DRAFT
  ↓
SUBMITTED
  ↓
VENDOR_ACCEPTED
  ↓
IN_PRODUCTION
  ↓
READY_FOR_INSTALL
  ↓
COMPLETED
```

Cancellation:

```text
DRAFT
SUBMITTED
VENDOR_ACCEPTED
        ↓
    CANCELLED
```

Cancellation is not permitted from `IN_PRODUCTION` or later.

`COMPLETED` and `CANCELLED` are terminal states.

## Single source of truth

Define lifecycle rules once in a shared domain module.

The same rule definition should power:

- frontend available actions.
- backend validation.
- tests.

Never trust the frontend to enforce workflow correctness.

Invalid transitions must return:

```text
HTTP 400
```

with a structured application error.

---

# 6. Backward/failure handling

Do not create many new order statuses.

Operational failures should be represented using:

- issue fields.
- action-required metadata.
- OrderEvent history.
- explicit manager correction/override actions where necessary.

Examples:

- asset invalid.
- vendor needs corrected file.
- operational exception.
- installer verification failed.

If a manager performs an exceptional override or rollback, record it clearly as an event with actor, timestamp, previous state, new state, and reason.

Normal non-admin users must not perform arbitrary backward jumps.

---

# 7. Order ownership and business fields

Each order represents one signage job.

Suggested fields:

```text
id
title
customerBusiness
customerContactName
customerContactEmail
signageDescription
quantity
installationAddress
requestedInstallationDate
price
notes
vendorId
status
revision
createdById
createdAt
updatedAt
```

Notes:

- `quantity` must be positive.
- `requestedInstallationDate` is a business date.
- timestamps/deadlines use UTC.
- `price` is operational/demo data only; no payment processing is implemented.
- one order has one selected vendor.
- one order may have multiple assets.
- one order produces at most one InstallationJob in this assignment.

---

# 8. Vendor workflow

The vendor is selected by the Manager.

There is no vendor marketplace and no vendor competition flow.

Workflow:

```text
Manager creates DRAFT
        ↓
Manager selects Vendor
        ↓
Manager submits
        ↓
SUBMITTED
        ↓
Selected Vendor accepts
        ↓
VENDOR_ACCEPTED
        ↓
Completed asset exists
        ↓
Vendor starts production
        ↓
IN_PRODUCTION
        ↓
Vendor finishes production
        ↓
READY_FOR_INSTALL
```

Vendor assignment is fixed after submission unless changed through an explicit Manager-only correction action.

The Vendor must be able to inspect completed assets before accepting/starting production.

Production must not begin unless at least one asset is `COMPLETED`.

---

# 9. InstallationJob as a separate entity

Do not store the entire installer workflow directly inside the Order.

Use a separate:

**InstallationJob – עבודת התקנה**

This keeps the two state machines separate.

## Creation

An InstallationJob is created automatically when an Order successfully transitions:

```text
IN_PRODUCTION
      ↓
READY_FOR_INSTALL
```

Creation must be idempotent.

Repeated requests must not create duplicate jobs.

## InstallationJob states

```text
AVAILABLE
   ↓
RESERVED
   ↓
ASSIGNED
   ↓
COMPLETED
```

A failed or expired reservation returns logically to:

```text
AVAILABLE
```

Suggested fields:

```text
id
orderId
status
claimId
reservedByInstallerId
assignedInstallerId
reservedAt
expiresAt
identityVerificationStatus
paymentVerificationStatus
completedAt
revision
createdAt
updatedAt
```

Possible verification statuses:

```text
NOT_STARTED
CHECKING
PASSED
FAILED
```

---

# 10. Installer marketplace

Installers can view all available installation jobs.

The UI may sort or prioritize them using simple deterministic criteria such as:

- installation date.
- distance or region.
- payout.
- rating compatibility.
- availability.

If a match score is shown, it must be a transparent rule-based score, not presented as AI.

Example:

```text
Distance      40%
Availability  30%
Rating        20%
Experience    10%
```

This is optional polish and must not delay core functionality.

---

# 11. Atomic claim and concurrency strategy

This is a critical assignment requirement.

Exactly one installer must be able to reserve a job when many installers claim simultaneously.

Do not use:

- in-memory locks.
- browser timers.
- process-local state.
- naive `read → check → write`.

Use MongoDB as the correctness authority.

## Claim operation

When an installer claims a job:

1. Validate authentication.
2. Validate installer role.
3. Validate job eligibility.
4. Generate a unique `claimId`.
5. Generate server deadline:

```text
expiresAt = now + 180 seconds
```

6. Perform one atomic conditional database update.

The update must succeed only when:

- the job belongs to an order currently eligible for installation.
- there is no APPROVED/ASSIGNED installer.
- the job is `AVAILABLE`, OR
- the job is `RESERVED` but `expiresAt <= now`.

The update:

- sets status to `RESERVED`.
- stores installer ID.
- stores claim ID.
- stores `reservedAt`.
- stores `expiresAt`.
- resets verification fields.
- increments `revision`.

Exactly one simultaneous contender succeeds.

All losers return:

```text
409 Conflict
```

with safe current job state.

## Optimistic concurrency

Use `revision` / expected revision where relevant.

Stale mutations should return:

```text
409 VERSION_CONFLICT
```

This applies to:

- state transitions.
- administrative edits.
- claim decisions.
- other stale mutation cases.

---

# 12. Reservation expiry strategy

Do not require QStash for correctness.

Use:

**expiresAt + lazy expiry – תפוגה לוגית לפי זמן שרת**

The database predicate is the source of truth.

A reservation is logically available when:

```text
status === RESERVED
AND
expiresAt <= serverNow
```

This means a later installer can claim the job atomically even if no background worker has physically changed the old row/document yet.

Reads should normalize expired reservations as available.

A lightweight cleanup mechanism may physically reset expired reservations, but this is optional housekeeping.

Possible housekeeping mechanisms:

- opportunistic cleanup during API reads.
- cleanup when an SSE connection starts.
- periodic background cleanup if easily available.
- optional QStash callback.

Important:

**No background callback may be required for correctness.**

An old callback or cleanup action must never clear a newer reservation.

---

# 13. Identity and payment verification

The original assignment explicitly mentions:

- Identity Verification – אימות זהות
- Payment Verification – אימות תשלום

Do not replace these with manager approval.

Implement them as realistic simulations.

After successful claim:

```text
RESERVED
↓
Identity Verification
↓
Payment Verification
```

The UI must show a visible countdown.

Example:

```text
Reserved for you
02:41 remaining

Identity Verification
✓ Passed

Payment Verification
● Checking...
```

## Verification behavior

The verification simulation can:

- run with short server-side delays.
- be deterministic or controlled by demo state.
- support success.
- support intentional demo failure.

Verification must validate:

- matching installer.
- matching claimId.
- reservation still active.
- server time is before expiry.

If either verification fails:

- reservation is released.
- job becomes logically AVAILABLE.
- event is recorded.

If both pass:

```text
RESERVED → ASSIGNED
```

After assignment, expiry must no longer release the job.

---

# 14. Completing installation

Only the assigned installer can complete an installation.

Conditions:

- matching assigned installer.
- associated order is `READY_FOR_INSTALL`.
- InstallationJob is `ASSIGNED`.

Successful completion should:

1. mark InstallationJob `COMPLETED`.
2. set completion timestamp.
3. transition Order to `COMPLETED`.
4. append event history.

Use a transaction when supported/appropriate so order completion and job completion do not diverge.

---

# 15. Assets and upload model

An Order may have multiple Assets.

Suggested Asset fields:

```text
id
orderId
uploaderId
objectKey
originalFilename
declaredSize
verifiedSize
contentType
multipartUploadId
status
createdAt
updatedAt
```

Suggested states:

```text
PENDING
UPLOADING
COMPLETED
FAILED
ABORTED
```

---

# 16. Preferred R2 upload implementation

Preferred implementation:

**Real direct-to-cloud multipart upload to Cloudflare R2**

Requirements:

- bucket remains private.
- no binary file payload should pass through Next.js.
- no file bytes stored in MongoDB.
- server generates object keys.
- browser uploads directly to R2.
- use pre-signed URLs.
- use multipart upload for large files.
- short-lived signed URLs.
- bounded concurrency, e.g. 3 parts.
- retry failed parts.
- refresh expired part URLs.
- support abort/cancel.
- server verifies completion.
- client cannot forge completion.
- authorized downloads use short-lived signed URLs.
- configure CORS correctly.

Suggested part size:

```text
16 MiB
```

Suggested file limit:

```text
2 GiB
```

Upload percentage should reflect real bytes in the uploading browser.

Do not store percentage updates in MongoDB on every chunk.

Persist only lifecycle changes such as:

- initiated.
- completed.
- failed.
- aborted.

---

# 17. Upload fallback strategy

The original task requires simulation, not necessarily a real storage provider.

Therefore:

**R2 is preferred but must not become a delivery blocker.**

If external R2 configuration, CORS, credentials, or provider setup threatens completion:

preserve the same interfaces and implement a fully functional:

**Simulated Direct-to-Cloud Upload – סימולציה מלאה של העלאה ישירה לענן**

The fallback must still demonstrate:

- request for signed upload URL.
- direct-upload architecture.
- upload progress.
- success.
- failure.
- retry.
- cancel where practical.
- final server-side completion state.

Document clearly in README whether the final deployment uses real R2 or simulation.

Do not claim real R2 integration unless verified.

---

# 18. Asset readiness

Add a lightweight production-readiness UI after upload.

Example:

```text
File Type       ✓
Dimensions      ✓
Resolution      ✓
Color Profile   ✓
```

This can be simulated.

If validation fails:

```text
Asset not ready for production
```

Production gating remains simple:

At least one Asset must be `COMPLETED`.

The readiness display is product polish and should not create an overcomplicated validation engine.

---

# 19. Live updates

Preferred architecture:

```text
MongoDB Change Streams
        ↓
SSE
        ↓
Authorized browser clients
```

Use the native MongoDB driver for Change Streams if Prisma does not expose this capability.

Use SSE for:

- order status changes.
- installation job status changes.
- claim/reservation updates.
- completed upload lifecycle changes.
- operational history updates.

Do not stream full sensitive documents.

Send minimal event metadata and invalidate/refetch the relevant TanStack Query caches.

## SSE requirements

- authenticate every connection.
- authorize event visibility.
- heartbeat.
- clean up listeners/cursors.
- reconnect with backoff.
- refresh authoritative state after reconnect.
- show disconnected state in UI.
- provide manual refresh.
- avoid periodic DB polling as fallback.

## Feasibility rule

Verify SSE behavior on Vercel very early.

If platform/runtime constraints make the chosen Change Stream architecture unreliable within the assignment timeframe, preserve the SSE API abstraction and use the simplest deployment-safe implementation that still avoids aggressive repeated database polling.

Document any deviation.

---

# 20. Dashboard and UI

The product should look like a real internal SaaS operations product.

Language:

**English UI**

Theme:

**Light, clean, premium B2B SaaS**

## Main dashboard structure

Use one main dashboard shell with role-aware views.

Recommended sidebar:

```text
Overview
Orders
Installations
Assets
```

Do not create many unrelated pages.

The dashboard may use internal routes or view states, but it should feel like one cohesive management application.

## Manager dashboard

Show:

- Active Orders.
- In Production.
- Ready for Install.
- Active Uploads.
- Order pipeline.
- recent activity.
- operational alerts.
- searchable orders.
- filters.
- pagination.

## Vendor dashboard

Show:

- Assigned Orders.
- Awaiting Acceptance.
- In Production.
- Ready for Install.
- Completed Orders.
- relevant assets.
- relevant history.

## Installer dashboard

Show:

- Available Jobs.
- reserved job.
- countdown.
- verification.
- assigned jobs.
- completed jobs.

---

# 21. Orders list and detail experience

Desktop/tablet:

- searchable table or table/card hybrid.

Mobile:

- cards.

Order detail should open in:

**Detail Drawer – מגירת פרטים**

The drawer should include:

- business details.
- order state.
- vendor.
- assets.
- installation job.
- history.
- allowed actions.

Use modals/dialogs for:

- create order.
- confirm state transition.
- cancel order.
- installer claim.
- verification.
- manager override if implemented.

Include:

- loading states.
- empty states.
- error states.
- focus management.
- keyboard accessibility.
- responsive controls.

---

# 22. Risk and attention indicators

Optional polish.

Use deterministic rules only.

Examples:

```text
HIGH RISK
Installation tomorrow
No installer assigned
```

```text
MEDIUM RISK
Asset incomplete
Production due soon
```

Possible Next Best Action:

```text
Upload asset
Contact vendor
Assign installer
Review failed verification
```

This must remain a small rule-based presentation feature.

Do not let it delay the required core flows.

---

# 23. OrderEvent history

Every meaningful mutation should append an event.

Suggested OrderEvent:

```text
id
orderId
actorId
actorRole
eventType
orderRevision
timestamp
details
visibility
```

Examples:

```text
ORDER_CREATED
ORDER_SUBMITTED
VENDOR_ACCEPTED
PRODUCTION_STARTED
READY_FOR_INSTALL
INSTALL_JOB_CREATED
INSTALL_JOB_RESERVED
IDENTITY_VERIFICATION_PASSED
PAYMENT_VERIFICATION_PASSED
INSTALLER_ASSIGNED
RESERVATION_EXPIRED
RESERVATION_RELEASED
UPLOAD_STARTED
UPLOAD_COMPLETED
UPLOAD_FAILED
ORDER_CANCELLED
ORDER_COMPLETED
ADMIN_OVERRIDE
```

Do not store secrets, signed URLs, passwords, or unnecessary customer data inside events.

---

# 24. Data model

Primary entities:

## User

```text
id
email
name
passwordHash
role
vendorProfile?
installerProfile?
createdAt
updatedAt
```

## Order

```text
id
title
customerBusiness
customerContactName
customerContactEmail
signageDescription
quantity
installationAddress
requestedInstallationDate
price
notes
vendorId
creatorId
status
revision
createdAt
updatedAt
```

## Asset

```text
id
orderId
uploaderId
objectKey
originalFilename
declaredSize
verifiedSize
contentType
multipartUploadId
status
createdAt
updatedAt
```

## InstallationJob

```text
id
orderId
status
claimId
reservedByInstallerId
assignedInstallerId
reservedAt
expiresAt
identityVerificationStatus
paymentVerificationStatus
revision
completedAt
createdAt
updatedAt
```

## OrderEvent

```text
id
orderId
actorId
actorRole
eventType
orderRevision
timestamp
details
visibility
```

Add indexes for:

- User.email unique.
- Orders by vendor/status.
- Orders by status/date.
- InstallationJobs by status/expiry.
- InstallationJobs by assigned installer.
- Assets by order.
- OrderEvents by order/timestamp.

---

# 25. API shape

Suggested route handlers:

```text
/api/auth/*
```

Authentication/session.

```text
/api/orders
```

Role-scoped list + creation.

```text
/api/orders/:id
```

Role-scoped details + allowed draft edits.

```text
/api/orders/:id/transition
```

Validated lifecycle transitions.

```text
/api/orders/:id/vendor
```

Manager-only vendor assignment/correction if needed.

```text
/api/install-jobs
```

Role-scoped installation jobs.

```text
/api/install-jobs/:id/claim
```

Atomic claim.

```text
/api/install-jobs/:id/verify/identity
```

Simulated identity verification.

```text
/api/install-jobs/:id/verify/payment
```

Simulated payment verification.

```text
/api/install-jobs/:id/complete
```

Assigned-installer completion.

```text
/api/uploads/initiate
/api/uploads/sign-parts
/api/uploads/complete
/api/uploads/abort
/api/uploads/download
```

Upload pipeline.

```text
/api/events
```

Authenticated SSE.

Optional:

```text
/api/demo/concurrency
```

Manager-only or development-only endpoint for demonstrating concurrent claims.

Do not expose unsafe debug endpoints in production unless access-controlled.

---

# 26. Error model

Use structured application errors.

Example shape:

```ts
{
  code: string
  message: string
  details?: unknown
}
```

Recommended behavior:

## 400 Bad Request

Examples:

- invalid transition.
- invalid form data.
- cancellation after production.
- production without completed asset.

User message:

> This action is not available for the order in its current state.

## 401 Unauthorized

User message:

> Your session is not active. Please sign in again.

## 403 Forbidden

User message:

> Your account does not have permission to perform this action.

## 404 Not Found

Avoid leaking existence of protected resources.

Use scoped lookups before deciding whether to return 404/403.

## 409 Conflict

Examples:

- installation job already claimed.
- stale revision.
- conflicting assignment.

User message:

> This job was just claimed by another installer. The job list has been refreshed.

or:

> This record changed since you opened it. Please review the latest version and try again.

## 500 / operational failure

User message:

> We could not complete the operation. No unsafe partial change was applied. Please try again.

Upload error:

> Upload failed. Your file was not marked as complete. You can retry the upload.

---

# 27. Concurrency demo

Include a reviewer-friendly way to prove concurrency correctness.

Preferred:

Manager-only demo action:

```text
Simulate Concurrent Claims
```

It should issue multiple real claim requests against one eligible job.

Display the result:

```text
Installer A → 200 Success
Installer B → 409 Conflict
Installer C → 409 Conflict
```

This is optional UI polish, but the underlying integration test is mandatory.

---

# 28. Testing strategy

Use:

- Vitest.
- integration tests against real isolated MongoDB.
- Playwright for critical browser flows.

Do not rely on mocks for concurrency correctness.

## State-machine tests

Verify:

- every legal transition.
- illegal skipped transition returns 400.
- arbitrary backward transition fails.
- terminal transitions fail.
- cancellation before production succeeds.
- cancellation after production fails.
- production without completed asset fails.

## Authorization tests

Verify:

- Vendor cannot access another vendor's order.
- Installer cannot change production state.
- Installer cannot access protected print files.
- Vendor cannot claim installation jobs.
- non-manager cannot perform manager-only corrections.
- unauthenticated API requests fail.
- SSE visibility obeys role rules.

## Concurrency tests

At least:

```text
20 concurrent installer claim requests
```

Expected:

```text
1 success
19 conflicts
```

Verify:

- exactly one reservation exists.
- reservation owner matches winner.
- no duplicate assignment.

Also test:

- independent app instances obey database correctness.
- stale revisions return 409.
- old claimId cannot mutate a new reservation.

## Expiry tests

Verify:

- expired reservation is logically available.
- another installer can claim after expiry.
- expired installer cannot complete verification.
- old cleanup action cannot clear newer reservation.
- assignment survives old expiry cleanup.

## Verification tests

Verify:

- only reservation owner can verify.
- verification after expiry fails.
- failed verification releases reservation.
- both passed verifications lead to ASSIGNED.
- ASSIGNED job cannot be stolen.

## Upload tests

Verify:

- upload lifecycle.
- completion cannot be forged.
- failed part retries remain bounded.
- abort works.
- oversize upload rejected.
- unauthorized download rejected.
- production gate requires completed Asset.

If real R2 is used:

- manually verify at least one large upload.
- confirm file bytes bypass Next.js.

## Browser tests

Critical Playwright flows:

1. login.
2. Manager creates and submits order.
3. Vendor accepts.
4. Vendor starts production.
5. Vendor marks ready.
6. Installer claims.
7. verification passes.
8. Installer completes.
9. Order becomes COMPLETED.
10. responsive dashboard flow.
11. conflict case.
12. invalid transition case.

---

# 29. Seed/demo data

Create idempotent seed data.

Suggested:

- 1 Manager.
- 2 Vendors.
- 3 Installers.
- 8–12 Orders.
- orders distributed across all lifecycle states.
- several completed assets.
- several available install jobs.
- one reserved demo job if useful.
- realistic fictional companies.

Avoid relying on real brands.

The seed command must be safe to rerun.

Do not automatically wipe production data.

---

# 30. UI quality requirements

The product should look polished enough to feel like a real operational SaaS tool.

Use:

- consistent spacing.
- clear typography.
- strong status hierarchy.
- accessible color contrast.
- role-aware empty states.
- clean cards/tables.
- clear loading skeletons.
- toast notifications.
- confirmation dialogs.
- useful timestamps.
- status chips.
- progress bars.
- countdown.
- responsive navigation.
- mobile-friendly cards.

No dead buttons.

If a visible control is not implemented, remove it.

---

# 31. Security requirements

- credentials only in environment variables.
- `.env.example` contains placeholders only.
- never log passwords.
- never log signed upload URLs.
- never expose storage secrets to the browser.
- private R2 bucket.
- short-lived signed URLs.
- secure cookies.
- role checks server-side.
- resource-scoped queries.
- validate input with Zod.
- sanitize event details.
- rate-limit or bound login attempts.
- use safe error responses.
- do not trust client-provided ownership.
- do not trust client-provided upload completion.

---

# 32. Transactions and atomicity

Use database transactions where they materially protect invariants, especially:

- order state change + event creation.
- installation completion + order completion + event creation.

Do not call external services inside database transactions.

For installer claims, atomic conditional update is the primary correctness mechanism.

Use bounded retry for transient transactional conflicts where appropriate.

---

# 33. Deployment strategy

Target:

**Vercel**

Database:

**MongoDB Atlas**

Storage:

**Cloudflare R2 preferred**

No QStash dependency is required.

Before building the full app, deploy a minimal version early and verify:

- MongoDB connectivity.
- Auth.js sessions.
- SSE streaming.
- reconnect behavior.
- R2 CORS if using real R2.
- function/runtime limits.
- environment variables.

Do not leave deployment until the final day.

---

# 34. Docker

Deliver:

- `Dockerfile`
- `docker-compose.yml`

The application should be runnable locally.

Provide a separate local MongoDB setup suitable for integration/concurrency tests.

If MongoDB transactions/change streams are required in local tests, use a local replica-set configuration.

External services such as R2 can remain environment-configured.

---

# 35. Build sequence

## Stage 1 — Foundation and feasibility

- inspect repository/workspace.
- inspect available Codex tools.
- verify runtime.
- verify package compatibility.
- scaffold Next.js + TS.
- configure MUI + Tailwind.
- configure Zod/forms/query.
- configure test tooling.
- define Prisma schema.
- configure MongoDB.
- implement Auth.js.
- implement role guards.
- seed demo users.
- create Docker setup.
- deploy minimal Vercel version.
- verify MongoDB + auth + SSE.
- verify R2 if available.
- document compatibility deviations.

Do not proceed deep into UI before deployment/integration feasibility is known.

## Stage 2 — Orders and dashboard

- implement Order domain service.
- implement state machine.
- implement order APIs.
- implement role-scoped reads.
- implement OrderEvent.
- implement Manager create/edit/submit.
- implement vendor assignment.
- implement Vendor accept/start production/ready.
- implement cancellation.
- implement dashboard shell.
- implement responsive order list.
- implement detail drawer.
- implement dialogs.
- implement history.

## Stage 3 — Installation jobs and concurrency

- create InstallationJob on READY_FOR_INSTALL.
- implement installer marketplace.
- implement atomic claim.
- implement lazy expiry.
- implement countdown.
- implement simulated identity verification.
- implement simulated payment verification.
- implement failure/release.
- implement assignment.
- implement completion.
- implement concurrency tests.
- implement expiry tests.
- optionally implement reviewer concurrency demo.

## Stage 4 — Upload and live behavior

- implement Asset schema.
- implement upload architecture.
- prefer real R2 multipart upload.
- implement progress.
- retry.
- abort.
- completion verification.
- asset readiness UI.
- production gating.
- implement SSE.
- wire Change Streams or simplest safe live-update source.
- test cross-session updates.
- test reconnect.

If R2 blocks delivery, switch behind the same abstraction to the simulated upload fallback.

## Stage 5 — Submission readiness

- accessibility pass.
- responsive pass.
- loading/empty/error states.
- polish.
- lint.
- TypeScript check.
- unit tests.
- integration tests.
- Playwright critical flows.
- production build.
- deployed smoke test.
- README.
- demo accounts.
- architecture diagrams.
- reviewer walkthrough.
- known tradeoffs.
- final GitHub repository.
- final live URL.

---

# 36. Acceptance criteria

The implementation is ready only when:

- login works for all seeded roles.
- authorization is enforced server-side.
- Manager can create a valid order.
- vendor can advance only assigned orders.
- state transitions are enforced in backend.
- invalid jumps return 400.
- cancellation rules are correct.
- production requires a completed asset.
- READY_FOR_INSTALL creates exactly one InstallationJob.
- installers can see available jobs.
- simultaneous claims produce exactly one winner.
- losers receive 409.
- reservation lasts 3 minutes by server time.
- expired jobs become logically available.
- verification cannot succeed after expiry.
- failed verification releases the job.
- successful verification assigns the installer.
- only assigned installer can complete.
- completion closes both job and order.
- history records meaningful events.
- upload architecture demonstrates direct-to-cloud behavior.
- upload progress is visible.
- failed upload can retry.
- dashboard works on mobile/tablet/desktop.
- SSE/live behavior works or a documented deployment-safe equivalent is used.
- tests prove lifecycle, authorization, concurrency, expiry, and uploads.
- Docker setup exists.
- README explains architecture.
- Vercel deployment works.
- GitHub repository is ready for review.

---

# 37. README requirements

README must document:

1. Project overview.
2. Technology stack.
3. Architecture.
4. User roles.
5. Demo credentials.
6. Database schema.
7. Order state machine.
8. InstallationJob state machine.
9. Authentication/authorization.
10. Atomic claim strategy.
11. Why `expiresAt` is the correctness source.
12. Identity/payment verification simulation.
13. Direct-to-cloud upload pipeline.
14. R2 vs simulated fallback status.
15. SSE/live update architecture.
16. Environment variables.
17. Local setup.
18. Docker setup.
19. Seed command.
20. Test commands.
21. Deployment setup.
22. Known limitations.
23. Architectural tradeoffs.
24. Reviewer demo walkthrough.

---

# 38. Suggested reviewer demo

Use this sequence during review:

1. Sign in as Manager.
2. Create an order.
3. Assign Vendor.
4. Upload or simulate asset upload.
5. Submit.
6. Sign in as Vendor.
7. Accept order.
8. Try starting production before asset completion if possible → show 400.
9. Start production correctly.
10. Mark READY_FOR_INSTALL.
11. Open Installer session A.
12. Open Installer session B.
13. Claim simultaneously.
14. Show one success and one 409.
15. Show 3-minute reservation countdown.
16. Complete identity verification.
17. Complete payment verification.
18. Show ASSIGNED.
19. Complete installation.
20. Show Order COMPLETED.
21. Open Manager dashboard.
22. Show history and live updates.

Optional:

Run "Simulate Concurrent Claims" and show automated conflict result.

---

# 39. Logging and diagnostics

Log safely:

- request IDs.
- transition failures.
- authorization denials.
- version conflicts.
- claim conflicts.
- expired claims.
- verification failures.
- SSE failures.
- upload failures.

Do not log:

- passwords.
- auth secrets.
- signed URLs.
- storage secrets.
- unnecessary customer PII.

---

# 40. Configuration expected during implementation

Request only when needed:

- MongoDB Atlas URI.
- MongoDB database name.
- Auth secret.
- R2 account ID.
- R2 bucket.
- R2 S3 key ID/secret.
- Vercel project access.
- GitHub repository access.

Continue independent implementation while optional external configuration is pending.

Never invent credentials.

Never report integration success without verifying it.

---

# 41. Codex working instructions

When starting implementation:

1. Read this document completely.
2. Read the original SignCraft task specification.
3. Inspect the workspace.
4. Inspect available tools.
5. Verify current package compatibility before installing.
6. Build incrementally.
7. Keep domain logic outside UI components.
8. Keep route handlers thin.
9. Keep authorization server-side.
10. Use database correctness, not process memory, for concurrent claims.
11. Do not silently expand scope.
12. Do not remove assignment requirements to simplify implementation.
13. Prefer a complete, reliable core over unfinished optional polish.
14. If an external provider blocks progress, use the documented fallback.
15. Keep this implementation plan updated if an architectural deviation becomes necessary.
16. Record why the deviation was made.
17. Run tests continuously.
18. Verify deployment early.
19. Do not claim success without executing the relevant check.

---

# 42. Suggested first Codex prompt

Use:

> Read `IMPLEMENTATION_PLAN.md` and the original SignCraft task specification completely before changing files. Treat `IMPLEMENTATION_PLAN.md` as the agreed implementation handoff and the original specification as the source of mandatory assignment requirements. Inspect the workspace and available development tools, verify package compatibility, and begin with Stage 1: foundation and deployment/integration feasibility. Preserve the stated scope and architecture unless a technical constraint requires a deviation. If a deviation is necessary, document it in the plan before implementing it. Do not invent credentials and do not claim an external integration works unless it has been verified. Keep implementation production-like, testable, role-secure, and visually polished.
