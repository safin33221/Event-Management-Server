-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'COORDINATOR', 'ACCOUNTANT', 'STAFF');

-- CreateEnum
CREATE TYPE "AdvancePolicyType" AS ENUM ('NONE', 'PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('NEW', 'QUALIFIED', 'QUOTED', 'CONVERTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'SUPERSEDED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuoteVersionStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AcceptanceChannel" AS ENUM ('PORTAL', 'PHONE', 'IN_PERSON', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('CREW', 'EQUIPMENT', 'ROOM', 'OTHER');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('RESERVED', 'RELEASED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('RECEIPT', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BKASH', 'NAGAD', 'BANK', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationState" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('CREDIT_NOTE', 'REVERSAL', 'CHARGE_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('APPROVED', 'VOID');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliverableStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'DELIVERED');

-- CreateTable
CREATE TABLE "studio_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL DEFAULT 'Softilo Event Management',
    "logo_url" TEXT,
    "theme_tokens" JSONB,
    "contact_details" JSONB,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "advance_policy_type" "AdvancePolicyType" NOT NULL DEFAULT 'PERCENTAGE',
    "advance_policy_value" BIGINT NOT NULL DEFAULT 20,
    "operational_policies" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_counters" (
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sequence_counters_pkey" PRIMARY KEY ("prefix","year")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STAFF',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_types" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_items" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit_label" TEXT NOT NULL DEFAULT 'unit',
    "default_unit_price_poisha" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" UUID NOT NULL,
    "event_type_id" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "base_price_poisha" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_items" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "service_item_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_poisha" BIGINT NOT NULL,

    CONSTRAINT "package_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_items" (
    "id" UUID NOT NULL,
    "event_type_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "media_url" TEXT NOT NULL,
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_templates" (
    "id" UUID NOT NULL,
    "event_type_id" UUID,
    "title" TEXT NOT NULL,
    "role_label" TEXT NOT NULL,
    "default_offset_days" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverable_labels" (
    "id" UUID NOT NULL,
    "event_type_id" UUID,
    "label" TEXT NOT NULL,
    "default_due_days" INTEGER NOT NULL DEFAULT 14,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "deliverable_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiries" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "event_type_id" UUID,
    "package_id" UUID,
    "event_title" TEXT NOT NULL,
    "requested_date" DATE,
    "client_name" TEXT NOT NULL,
    "client_phone" TEXT NOT NULL,
    "client_email" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "source" TEXT NOT NULL DEFAULT 'PUBLIC',
    "status" "InquiryStatus" NOT NULL DEFAULT 'NEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "inquiry_id" UUID,
    "reference" TEXT NOT NULL,
    "event_type_id" UUID,
    "event_title" TEXT NOT NULL,
    "requested_date" DATE,
    "client_name" TEXT NOT NULL,
    "client_phone" TEXT NOT NULL,
    "client_email" TEXT,
    "currency" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "current_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_versions" (
    "id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "subtotal_poisha" BIGINT NOT NULL,
    "discount_poisha" BIGINT NOT NULL DEFAULT 0,
    "total_poisha" BIGINT NOT NULL,
    "terms" TEXT,
    "valid_until" DATE,
    "status" "QuoteVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "accepted_at" TIMESTAMP(3),
    "accepted_by" TEXT,
    "accepted_channel" "AcceptanceChannel",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_line_items" (
    "id" UUID NOT NULL,
    "quote_version_id" UUID NOT NULL,
    "package_id" UUID,
    "service_item_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_poisha" BIGINT NOT NULL,
    "line_total_poisha" BIGINT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quote_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "quote_id" UUID NOT NULL,
    "accepted_quote_version_id" UUID NOT NULL,
    "event_type_id" UUID,
    "event_title" TEXT NOT NULL,
    "event_date" DATE,
    "client_name" TEXT NOT NULL,
    "client_phone" TEXT NOT NULL,
    "client_email" TEXT,
    "metadata" JSONB,
    "currency" TEXT NOT NULL,
    "agreed_total_poisha" BIGINT NOT NULL,
    "advance_policy_type_override" "AdvancePolicyType",
    "advance_policy_value_override" BIGINT,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL,
    "user_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_sessions" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_reservations" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_audit_logs" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "session_id" UUID,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "previous_start_at" TIMESTAMP(3),
    "previous_end_at" TIMESTAMP(3),
    "new_start_at" TIMESTAMP(3),
    "new_end_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_entries" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "type" "PaymentType" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_poisha" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "transaction_ref" TEXT,
    "verification_state" "VerificationState" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT,
    "payload_hash" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "verified_by_id" UUID,
    "verified_at" TIMESTAMP(3),
    "reason" TEXT,
    "related_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_adjustments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "amount_poisha" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'APPROVED',
    "actor_id" UUID NOT NULL,
    "related_payment_id" UUID,
    "idempotency_key" TEXT,
    "payload_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "session_id" UUID,
    "assignee_user_id" UUID NOT NULL,
    "role_label" TEXT NOT NULL,
    "notes" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverables" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "assignee_user_id" UUID,
    "due_at" TIMESTAMP(3),
    "review_status" "DeliverableStatus" NOT NULL DEFAULT 'PENDING',
    "delivered_at" TIMESTAMP(3),
    "delivery_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_is_active_idx" ON "users"("role", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "event_types_slug_key" ON "event_types"("slug");

-- CreateIndex
CREATE INDEX "service_items_is_active_idx" ON "service_items"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "packages_slug_key" ON "packages"("slug");

-- CreateIndex
CREATE INDEX "packages_is_published_is_active_idx" ON "packages"("is_published", "is_active");

-- CreateIndex
CREATE INDEX "package_items_package_id_idx" ON "package_items"("package_id");

-- CreateIndex
CREATE INDEX "portfolio_items_is_approved_is_published_sort_order_idx" ON "portfolio_items"("is_approved", "is_published", "sort_order");

-- CreateIndex
CREATE INDEX "task_templates_is_active_idx" ON "task_templates"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "deliverable_labels_label_key" ON "deliverable_labels"("label");

-- CreateIndex
CREATE UNIQUE INDEX "inquiries_reference_key" ON "inquiries"("reference");

-- CreateIndex
CREATE INDEX "inquiries_status_requested_date_idx" ON "inquiries"("status", "requested_date");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_reference_key" ON "quotes"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_current_version_id_key" ON "quotes"("current_version_id");

-- CreateIndex
CREATE INDEX "quotes_status_idx" ON "quotes"("status");

-- CreateIndex
CREATE INDEX "quote_versions_quote_id_idx" ON "quote_versions"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_versions_quote_id_version_number_key" ON "quote_versions"("quote_id", "version_number");

-- CreateIndex
CREATE INDEX "quote_line_items_quote_version_id_idx" ON "quote_line_items"("quote_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_reference_key" ON "bookings"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_quote_id_key" ON "bookings"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_accepted_quote_version_id_key" ON "bookings"("accepted_quote_version_id");

-- CreateIndex
CREATE INDEX "bookings_status_event_date_idx" ON "bookings"("status", "event_date");

-- CreateIndex
CREATE INDEX "resources_type_is_active_idx" ON "resources"("type", "is_active");

-- CreateIndex
CREATE INDEX "event_sessions_start_at_end_at_idx" ON "event_sessions"("start_at", "end_at");

-- CreateIndex
CREATE INDEX "event_sessions_booking_id_idx" ON "event_sessions"("booking_id");

-- CreateIndex
CREATE INDEX "resource_reservations_resource_id_status_start_at_end_at_idx" ON "resource_reservations"("resource_id", "status", "start_at", "end_at");

-- CreateIndex
CREATE INDEX "schedule_audit_logs_booking_id_created_at_idx" ON "schedule_audit_logs"("booking_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_entries_booking_id_verification_state_idx" ON "payment_entries"("booking_id", "verification_state");

-- CreateIndex
CREATE UNIQUE INDEX "payment_entries_type_idempotency_key_key" ON "payment_entries"("type", "idempotency_key");

-- CreateIndex
CREATE INDEX "price_adjustments_booking_id_status_idx" ON "price_adjustments"("booking_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "price_adjustments_type_idempotency_key_key" ON "price_adjustments"("type", "idempotency_key");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "assignments_assignee_user_id_status_idx" ON "assignments"("assignee_user_id", "status");

-- CreateIndex
CREATE INDEX "assignments_booking_id_idx" ON "assignments"("booking_id");

-- CreateIndex
CREATE INDEX "deliverables_booking_id_idx" ON "deliverables"("booking_id");

-- CreateIndex
CREATE INDEX "deliverables_due_at_review_status_idx" ON "deliverables"("due_at", "review_status");

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_items" ADD CONSTRAINT "package_items_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_items" ADD CONSTRAINT "package_items_service_item_id_fkey" FOREIGN KEY ("service_item_id") REFERENCES "service_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_labels" ADD CONSTRAINT "deliverable_labels_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_version_id_fkey" FOREIGN KEY ("quote_version_id") REFERENCES "quote_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_accepted_quote_version_id_fkey" FOREIGN KEY ("accepted_quote_version_id") REFERENCES "quote_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_sessions" ADD CONSTRAINT "event_sessions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "event_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_entries" ADD CONSTRAINT "payment_entries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_adjustments" ADD CONSTRAINT "price_adjustments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "event_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Enforce half-open [start_at, end_at) resource exclusivity at the PostgreSQL level
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "resource_reservations"
  ADD CONSTRAINT "resource_reservations_no_overlap"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    tsrange("start_at", "end_at", '[)') WITH &&
  )
  WHERE ("status" = 'RESERVED');
