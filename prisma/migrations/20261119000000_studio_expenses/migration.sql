-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('CREW_PAYOUT', 'EQUIPMENT_RENTAL', 'ALBUM_PRINTING', 'TRANSPORT_FOOD', 'VENUE_DECOR', 'STUDIO_OVERHEAD', 'MARKETING', 'OTHER');

-- CreateTable
CREATE TABLE "expense_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID,
    "category" "ExpenseCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "vendor_or_payee" TEXT,
    "amount_poisha" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "incurred_on" DATE NOT NULL,
    "notes" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_entries_incurred_on_category_idx" ON "expense_entries"("incurred_on", "category");

-- CreateIndex
CREATE INDEX "expense_entries_booking_id_idx" ON "expense_entries"("booking_id");

-- AddForeignKey
ALTER TABLE "expense_entries" ADD CONSTRAINT "expense_entries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
