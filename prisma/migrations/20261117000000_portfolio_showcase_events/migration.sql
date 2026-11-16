-- CreateEnum
CREATE TYPE "PortfolioEventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PortfolioMediaType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "PortfolioMediaStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "portfolio_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_type_id" UUID,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "event_date" DATE,
    "description" TEXT,
    "location" TEXT,
    "status" "PortfolioEventStatus" NOT NULL DEFAULT 'DRAFT',
    "cover_media_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "asset_id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "resource_type" "PortfolioMediaType" NOT NULL,
    "format" TEXT NOT NULL,
    "secure_url" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "duration_seconds" DOUBLE PRECISION,
    "caption" TEXT,
    "alt_text" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "status" "PortfolioMediaStatus" NOT NULL DEFAULT 'READY',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_events_slug_key" ON "portfolio_events"("slug");

-- CreateIndex
CREATE INDEX "portfolio_events_status_sort_order_event_date_idx" ON "portfolio_events"("status", "sort_order", "event_date");

-- CreateIndex
CREATE INDEX "portfolio_media_event_id_display_order_idx" ON "portfolio_media"("event_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_media_event_id_asset_id_key" ON "portfolio_media"("event_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_media_event_id_public_id_key" ON "portfolio_media"("event_id", "public_id");

-- AddForeignKey
ALTER TABLE "portfolio_events" ADD CONSTRAINT "portfolio_events_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_media" ADD CONSTRAINT "portfolio_media_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "portfolio_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_events" ADD CONSTRAINT "portfolio_events_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "portfolio_media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
