CREATE TYPE "StreakPurchaseStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'FAILED');

CREATE TABLE "creator_streaks" (
    "id" TEXT NOT NULL,
    "fan_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 0,
    "last_paid_on" TEXT,
    "active_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_streaks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "streak_purchases" (
    "id" TEXT NOT NULL,
    "fan_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "provider_order_id" TEXT NOT NULL,
    "payment_session_id" TEXT,
    "provider_payment_id" TEXT,
    "amount_paise" INTEGER NOT NULL,
    "status" "StreakPurchaseStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "streak_purchases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "creator_streaks_fan_id_creator_id_key" ON "creator_streaks"("fan_id", "creator_id");
CREATE UNIQUE INDEX "streak_purchases_provider_order_id_key" ON "streak_purchases"("provider_order_id");
CREATE INDEX "streak_purchases_fan_id_creator_id_created_at_idx" ON "streak_purchases"("fan_id", "creator_id", "created_at" DESC);

ALTER TABLE "creator_streaks" ADD CONSTRAINT "creator_streaks_fan_id_fkey" FOREIGN KEY ("fan_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "creator_streaks" ADD CONSTRAINT "creator_streaks_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creator_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "streak_purchases" ADD CONSTRAINT "streak_purchases_fan_id_fkey" FOREIGN KEY ("fan_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "streak_purchases" ADD CONSTRAINT "streak_purchases_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creator_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
