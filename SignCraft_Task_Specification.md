# SignCraft B2B Marketplace Management Application Task

Technical Assessment & Candidate Guidelines

## Overview

You are tasked with developing a full-stack micro-application to manage orders, vendor assignments, and installer state flows for SignCraft - a B2B marketplace for custom physical signage. The UI/UX flow and system rules are specified below.

## Project Requirements

- **Framework:** Next.js (App Router) or Remix
- **Database:** MongoDB (with Prisma ORM)
- **CSS & UI:** Tailwind CSS & Shadcn UI / MUI
- **Language:** TypeScript

## Application Details

The application consists of a single-page management dashboard featuring real-time order lifecycle tracking, asset upload status, and interactive modals for Order Creation, Status Transitions, and Installer Assignment.

Implement the backend API and event processing using Next.js/Remix API Routes.

## Workflow & System Requirements

### 1. State Lifecycle & Validation

Enforce the following order state machine both on the frontend and backend:

```text
[DRAFT] -> [SUBMITTED] -> [VENDOR_ACCEPTED] -> [IN_PRODUCTION] -> [READY_FOR_INSTALL] -> [COMPLETED]
```

- Orders can transition to [CANCELLED] only prior to entering [IN_PRODUCTION].
- Invalid state jumps (e.g., [DRAFT] directly to [IN_PRODUCTION]) must be blocked with appropriate UI feedback and HTTP 400 API responses.

### 2. Concurrency & Double-Booking Prevention

Implement distributed locking (e.g., Redis lock or optimistic DB locking) on the job assignment endpoint to ensure that when multiple installers accept a job simultaneously, exactly one installer is assigned. Provide a fallback mechanism: if an installer claims a job but fails identity/payment verification within 3 minutes, release the lock automatically back to the marketplace.

### 3. Async File Upload Simulation

Simulate direct-to-cloud asset upload (e.g., 1GB+ print files) using pre-signed URLs. Display upload progress on the dashboard in real-time using WebSockets, Server-Sent Events (SSE), or optimistic UI updates without crashing HTTP nodes or repeatedly polling the database.

## Guidelines

Design and UI:

- Make the application responsive across mobile, tablet, and desktop views.
- Build intuitive UI indicators for real-time state changes, active uploads, and job claiming statuses.

## Deliverables

1. **Code Repository:** Create a public or private GitHub repository containing your full codebase, including containerized execution files (docker-compose.yml preferred).
2. **Architectural Spec & System Documentation:** Include a README.md documenting your database schema, concurrency lock strategy and direct-to-cloud upload pipeline.
3. **Deployment:** Deploy the application to a live platform (e.g., Vercel, Render, Railway, AWS) and provide the live deployment URL.

## Submission

When completed, submit your GitHub repository link and the live deployment URL.

Good luck! We are excited to see your architectural decisions and high-quality implementation. If you have any questions during development, please reach out.
