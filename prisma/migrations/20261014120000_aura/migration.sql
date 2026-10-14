-- CreateEnum
CREATE TYPE "AuraLedgerType" AS ENUM ('INVITE_ACCEPTED', 'GIFT_PAID', 'MILESTONE', 'REFUND_REVERSAL', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CosmeticKind" AS ENUM ('FRAME', 'EFFECT', 'THEME', 'BADGE');

-- CreateEnum
CREATE TYPE "CosmeticPurchaseStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'FAILED', 'REFUNDED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "earned_aura" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "aura_ledger_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "AuraLedgerType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "creator_id" TEXT,
    "order_item_id" TEXT,
    "refund_id" TEXT,
    "milestone_key" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aura_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_invite_claims" (
    "id" TEXT NOT NULL,
    "fan_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_invite_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_milestones" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "milestone_key" TEXT NOT NULL,
    "ledger_entry_id" TEXT NOT NULL,
    "achieved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cosmetic_items" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" "CosmeticKind" NOT NULL,
    "price_paise" INTEGER NOT NULL DEFAULT 0,
    "preview_url" TEXT,
    "css_class" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cosmetic_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_cosmetics" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'purchase',
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_cosmetics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_cosmetic_loadouts" (
    "user_id" TEXT NOT NULL,
    "frame_item_id" TEXT,
    "effect_item_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_cosmetic_loadouts_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "cosmetic_purchases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "provider_order_id" TEXT NOT NULL,
    "payment_session_id" TEXT,
    "provider_payment_id" TEXT,
    "amount_paise" INTEGER NOT NULL,
    "status" "CosmeticPurchaseStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cosmetic_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "aura_ledger_entries_idempotency_key_key" ON "aura_ledger_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "aura_ledger_entries_user_id_created_at_idx" ON "aura_ledger_entries"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "creator_invite_claims_fan_id_creator_id_key" ON "creator_invite_claims"("fan_id", "creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_milestones_user_id_milestone_key_key" ON "user_milestones"("user_id", "milestone_key");

-- CreateIndex
CREATE UNIQUE INDEX "user_milestones_ledger_entry_id_key" ON "user_milestones"("ledger_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "cosmetic_items_slug_key" ON "cosmetic_items"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "user_cosmetics_user_id_item_id_key" ON "user_cosmetics"("user_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "cosmetic_purchases_provider_order_id_key" ON "cosmetic_purchases"("provider_order_id");

-- CreateIndex
CREATE INDEX "cosmetic_purchases_user_id_created_at_idx" ON "cosmetic_purchases"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "aura_ledger_entries" ADD CONSTRAINT "aura_ledger_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_invite_claims" ADD CONSTRAINT "creator_invite_claims_fan_id_fkey" FOREIGN KEY ("fan_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_invite_claims" ADD CONSTRAINT "creator_invite_claims_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creator_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_milestones" ADD CONSTRAINT "user_milestones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_milestones" ADD CONSTRAINT "user_milestones_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "aura_ledger_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "cosmetic_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cosmetic_loadouts" ADD CONSTRAINT "user_cosmetic_loadouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cosmetic_purchases" ADD CONSTRAINT "cosmetic_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cosmetic_purchases" ADD CONSTRAINT "cosmetic_purchases_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "cosmetic_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
