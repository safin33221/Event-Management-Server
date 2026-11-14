# Softilo Event Management backend

Softilo Event Management is a single-tenant white-label event management product deployed per customer installation (clone-and-deploy model). Wedding PhotoArt is the default seeded preset. Each deployment serves one studio or event business from a dedicated database.

## Single-tenant white-label product contract

- Configure each client deployment through `StudioSettings` (seeded via `pnpm run db:seed` / `.env` and editable at runtime via `/studio/branding`) without requiring source edits or custom branches.
- Keep product identity separate from client studio identity. Store the studio display name, logo, approved theme tokens, contact details, timezone, currency, and advance policy in `StudioSettings`. Return a public-safe branding projection on `/public/branding`.
- Use neutral Softilo defaults for missing settings. Validate logo references and theme values. Keep credentials and private settings outside public branding responses.
- Keep event types, services, packages, task templates, and deliverable labels studio-owned. Supply photography, film, and album examples as an optional studio preset. A corporate event must be bookable without a couple, shoot, or album. Keep operational policies separate from visual themes.
- Retrying `db:seed` must preserve the owner's edits. Only authorized studio owners (`OWNER`) may edit branding and operational settings.

## Before changing code

- Read the root package.json, lockfile, Node version pin, Nest bootstrap, Prisma configuration, and the closest existing module and tests relevant to the task. A fresh scaffold may only contain some of these.
- Use the repository's package manager and local CLI versions. For a new setup, use pnpm, NestJS, TypeScript, Prisma, and PostgreSQL. Respect existing ESM/CommonJS and test-runner settings. Run the local Nest CLI through pnpm exec nest when using pnpm.
- Trace the entry point, DTO, permission check, service operation, persistence, and response before editing an existing flow. Preserve public routes, response shapes, and stored data unless the requested change requires a migration.
- Implement the requested slice. The initial handover covers packages and portfolio, inquiries, quotes, manual advances, booking confirmation, a calendar, and basic assignments. Vendor accounting, ticketing, gateways, and SaaS billing are separate work.

## NestJS structure and API contracts

- Organize code by business feature. Keep HTTP parsing and status codes in controllers, input validation in DTOs, and state transitions or multi-record writes in services. Reuse the existing Prisma provider, auth guards, and exception handling.
- Validate inputs at the boundary. Explicitly select writable fields. Resolve agency, actor, role, computed totals, and verification state on the server. Use response DTOs or explicit selects for public endpoints.
- Expose intent for consequential actions such as accepting a quote, confirming a booking, recording an advance, and issuing a refund. Route all callers through the same business rules, including dashboard actions and imports.
- Bound and paginate list endpoints. Use stable ordering and agency-scoped filters for date, reference, status, and assignee. Match the repository's HTTP error conventions and give clients a distinguishable conflict response for a stale version or unavailable resource.

## Booking and event operations

- A public or phone inquiry gets an agency-unique reference. Submitting an inquiry does not reserve the date. Keep the requested date separate from a confirmed time slot.
- A quote version snapshots its service descriptions, quantities, prices, discounts, and terms. Calculate totals on the server. Link the accepted version to its own booking and record who accepted it, when, and by what channel. Later package edits cannot change it. Changes to an agreed price require an explicit revision and acceptance.
- Confirmation requires an accepted quote and the agency's applicable advance policy. Keep the policy configurable where requirements vary. Never assume every booking requires the same advance percentage.
- Track booking state, payment balance, shoot schedule, and deliverable status independently. Completing a shoot must preserve outstanding dues and unfinished edits.
- Allow multiple shoot sessions for one booking when implementing multi-day events. Each album, film, or gallery can have its own assignee, deadline, review status, and delivery timestamp. Updating one deliverable must preserve its siblings.
- Treat a date-only request as a local calendar date. Store timed sessions as instants and interpret calendar filters using the agency timezone (Asia/Dhaka for the first customer). Two shoots can share a date. Check overlap for the same reserved resource using half-open intervals so adjacent slots can meet.
- Confirm, cancel, and reschedule atomically with their resource reservations. Enforce exclusivity under concurrent requests using a database constraint or transaction with appropriate locking and retry handling. A read-then-insert availability check alone can double-book a crew. Record who changed the schedule and why.

## Money and audit history

- Use one exact money representation throughout a flow, either integer poisha or PostgreSQL numeric with Prisma Decimal. Preserve precision in JSON. Use the agency currency (BDT for the first customer), snapshot it on financial records, and keep calculations out of JavaScript floating-point arithmetic.
- Outstanding balance equals the accepted charge minus verified receipts plus completed refunds, adjusted for any approved credit notes. Show an overpayment as customer credit. Keep vendor payments separate from customer receipts.
- Record amount, method, verification state, actor, booking, and time. For manual bKash, Nagad, bank, or cash entries, distinguish recording from verification. A submitted transaction reference alone does not verify receipt.
- Make financial writes idempotent with a database-backed unique key scoped to the operation. A retry with the same key and payload returns the original result. Reject reuse with different details. Commit the ledger entry and related audit record together.
- Correct posted entries with linked reversals or adjustments that retain the original. Record a reason and enforce the actor's permission. Preserve the difference between a cash refund and a reduction in the agreed charge.

## Access and data handling

- Obtain actor identity, active status, and role (`OWNER`, `COORDINATOR`, `ACCOUNTANT`, `STAFF`) directly from the authenticated `User` record on the server, alongside `StudioSettings` timezone and currency.
- Owners manage the studio, branding, team users, and all operations. Coordinators manage bookings and assigned operations. Accountants manage authorized financial actions. Staff see assigned work and the contact details needed for it. Implement roles required by the current release, with explicit permissions for verification, refunds, and exports.
- A booking reference is a lookup label. Private booking details, quotes, galleries, and receipts require authorized access. Public portfolio queries return only approved, published assets. Keep private uploads in restricted storage.
- Keep credentials, tokens, private media URLs, and full payment or contact details out of logs, fixtures, and commits. Validate required environment settings at startup. Document variable names with safe examples when configuration changes.

## Database changes

- Commit schema changes with a reviewed migration. Check existing records before adding required columns or uniqueness constraints. Use a staged backfill when old data needs conversion. Preserve accepted quotes, historical receipts, and references.
- Keep local development and deployment migration commands distinct. Run schema generation and migration tests against an appropriate development or disposable test database. Never reset a shared database or use schema push as a production migration.
- Use transactions for invariants spanning tables. Add indexes for actual lookup patterns such as booking reference, scheduled start, or delivery deadline.

## Verification and handoff

Use scripts actually declared in package.json. For a pnpm repository, pnpm run lists them. Run the relevant build, type checks, lint, and tests. Inspect scripts before using auto-fix options so unrelated files stay untouched.

For changes to these workflows, cover the affected behavior through the normal service or API entry point:

| Change | Regression to check |
| --- | --- |
| Quotes | Editing a package leaves an accepted quote unchanged. |
| Payments | A Tk 10,000 verified advance on Tk 50,000 leaves Tk 40,000 due, including after a retry. |
| Reservations | Two simultaneous confirmations for one crew and slot yield one reservation. Adjacent slots are allowed. |
| Authorization | Unauthorized roles (e.g. `STAFF`) cannot access owner/accountant mutations or financial exports. |
| Deliveries | Delivering a gallery leaves its film in editing and preserves the booking balance. |
| Calendar | A session just after local midnight appears under the correct agency-local date. |

Use PostgreSQL-backed tests when correctness depends on database constraints or transaction behavior. In the handoff, name the changed behavior, migrations or configuration required, checks actually run, and any checks still unverified.
