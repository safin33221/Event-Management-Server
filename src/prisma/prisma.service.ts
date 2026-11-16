import 'dotenv/config';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { Pool } from 'pg';

function createPrismaAdapter(): { pool: Pool; adapter: PrismaPg } {
  const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/softilo_events?schema=public';
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  return { pool, adapter };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor() {
    const { pool, adapter } = createPrismaAdapter();
    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test' && !process.env.DATABASE_URL) {
      return;
    }

    try {
      await this.$connect();
    } catch (error) {
      const pgCode = (error as { code?: string })?.code;
      // PostgreSQL 3D000 = database does not exist
      if (pgCode === '3D000' && process.env.DATABASE_URL) {
        await this.ensureDatabaseExists(process.env.DATABASE_URL);
        await this.$connect();
      } else {
        throw error;
      }
    }

    await this.ensurePortfolioShowcaseTables();
  }

  /**
   * Idempotently ensures the portfolio_events and portfolio_media tables and enums exist
   * so active dev/prod servers never fail with P2021 before `prisma migrate deploy` is run.
   */
  private async ensurePortfolioShowcaseTables(): Promise<void> {
    try {
      await this.pool.query(`
        DO $$ BEGIN
          CREATE TYPE "PortfolioEventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END $$;

        DO $$ BEGIN
          CREATE TYPE "PortfolioMediaType" AS ENUM ('IMAGE', 'VIDEO');
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END $$;

        DO $$ BEGIN
          CREATE TYPE "PortfolioMediaStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED');
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END $$;

        CREATE TABLE IF NOT EXISTS "portfolio_events" (
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
          "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "portfolio_events_pkey" PRIMARY KEY ("id")
        );

        CREATE TABLE IF NOT EXISTS "portfolio_media" (
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
          "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "portfolio_media_pkey" PRIMARY KEY ("id")
        );

        CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_events_slug_key" ON "portfolio_events"("slug");
        CREATE INDEX IF NOT EXISTS "portfolio_events_status_sort_order_event_date_idx" ON "portfolio_events"("status", "sort_order", "event_date");
        CREATE INDEX IF NOT EXISTS "portfolio_media_event_id_display_order_idx" ON "portfolio_media"("event_id", "display_order");
        CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_media_event_id_asset_id_key" ON "portfolio_media"("event_id", "asset_id");
        CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_media_event_id_public_id_key" ON "portfolio_media"("event_id", "public_id");

        DO $$ BEGIN
          ALTER TABLE "portfolio_events"
            ADD CONSTRAINT "portfolio_events_event_type_id_fkey"
            FOREIGN KEY ("event_type_id") REFERENCES "event_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        EXCEPTION
          WHEN duplicate_object THEN NULL;
          WHEN undefined_table THEN NULL;
        END $$;

        DO $$ BEGIN
          ALTER TABLE "portfolio_media"
            ADD CONSTRAINT "portfolio_media_event_id_fkey"
            FOREIGN KEY ("event_id") REFERENCES "portfolio_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END $$;

        DO $$ BEGIN
          ALTER TABLE "portfolio_events"
            ADD CONSTRAINT "portfolio_events_cover_media_id_fkey"
            FOREIGN KEY ("cover_media_id") REFERENCES "portfolio_media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END $$;
      `);
    } catch (err) {
      this.logger.warn(
        `Skipped auto-ensuring portfolio showcase tables: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }

  private async ensureDatabaseExists(databaseUrl: string): Promise<void> {
    const parsed = new URL(databaseUrl);
    const dbName = parsed.pathname.replace(/^\//, '');
    if (!dbName || !/^[a-zA-Z0-9_]+$/.test(dbName)) {
      throw new Error(`Invalid target database name in DATABASE_URL: "${dbName}"`);
    }

    const adminUrl = new URL(databaseUrl);
    adminUrl.pathname = '/postgres';
    adminUrl.searchParams.delete('schema');

    const adminPool = new Pool({ connectionString: adminUrl.toString() });
    try {
      const exists = await adminPool.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [dbName],
      );
      if (exists.rowCount === 0) {
        await adminPool.query(`CREATE DATABASE "${dbName}"`);
        this.logger.log(`Created missing PostgreSQL database "${dbName}"`);
      }
    } finally {
      await adminPool.end();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await this.pool.end();
  }

  /**
   * Generates a unique sequential reference (e.g. INQ-2026-0001)
   * atomically inside an existing transaction or standalone.
   */
  async nextReference(
    tx: Prisma.TransactionClient,
    prefix: 'INQ' | 'QUO' | 'BKG',
    year = new Date().getUTCFullYear(),
  ): Promise<string> {
    const seq = await tx.sequenceCounter.upsert({
      where: {
        prefix_year: { prefix, year },
      },
      create: {
        prefix,
        year,
        lastValue: 1,
      },
      update: {
        lastValue: { increment: 1 },
      },
    });
    const padded = String(seq.lastValue).padStart(4, '0');
    return `${prefix}-${year}-${padded}`;
  }
}
