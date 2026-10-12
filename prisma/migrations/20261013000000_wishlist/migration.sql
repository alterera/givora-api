-- Replace claim-link gifts with creator wishlists. Safe because no production orders exist.

DROP TABLE IF EXISTS "fulfilment_events" CASCADE;
DROP TABLE IF EXISTS "fulfilment_orders" CASCADE;
DROP TABLE IF EXISTS "shipping_addresses" CASCADE;
DROP TABLE IF EXISTS "claims" CASCADE;
DROP TABLE IF EXISTS "gift_events" CASCADE;
DROP TABLE IF EXISTS "gift_items" CASCADE;
DROP TABLE IF EXISTS "inventory_reservations" CASCADE;
DROP TABLE IF EXISTS "refunds" CASCADE;
DROP TABLE IF EXISTS "payment_events" CASCADE;
DROP TABLE IF EXISTS "payments" CASCADE;
DROP TABLE IF EXISTS "gifts" CASCADE;

DROP TYPE IF EXISTS "GiftStatus";
DROP TYPE IF EXISTS "FulfilmentStatus";

CREATE TYPE "ProductType" AS ENUM ('PHYSICAL', 'DIGITAL');
CREATE TYPE "CreatorStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'FAILED', 'EXPIRED', 'PARTIALLY_REFUNDED', 'REFUNDED');
CREATE TYPE "OrderItemStatus" AS ENUM ('PENDING', 'GIFTED', 'REFUNDED_UNAVAILABLE');
CREATE TYPE "GiftStatus" AS ENUM ('AWAITING_REDEMPTION', 'REDEEMED', 'FULFILLED', 'EXPIRED', 'CANCELLED', 'REFUNDED');
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'PACKED', 'SHIPPED', 'DELIVERED', 'FAILED', 'RETURNED');

ALTER TABLE "users" ADD COLUMN "telegram_id" TEXT;
ALTER TABLE "users" ADD COLUMN "telegram_username" TEXT;
ALTER TABLE "users" ADD COLUMN "bot_can_message" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

ALTER TABLE "products" ADD COLUMN "type" "ProductType" NOT NULL DEFAULT 'PHYSICAL';
ALTER TABLE "products" ADD COLUMN "shipping_paise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN "delivery_info" TEXT;
ALTER TABLE "products" ADD COLUMN "refund_terms" TEXT;
ALTER TABLE "products" ADD CONSTRAINT "products_shipping_nonneg" CHECK ("shipping_paise" >= 0);

CREATE TABLE "creator_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "short_code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "avatar_url" TEXT,
    "gift_note" TEXT NOT NULL DEFAULT '',
    "persona_disclosure" TEXT,
    "status" "CreatorStatus" NOT NULL DEFAULT 'PENDING',
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "creator_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "creator_profiles_user_id_key" ON "creator_profiles"("user_id");
CREATE UNIQUE INDEX "creator_profiles_slug_key" ON "creator_profiles"("slug");
CREATE UNIQUE INDEX "creator_profiles_short_code_key" ON "creator_profiles"("short_code");
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "wishlist_items" (
    "id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wishlist_items_creator_id_variant_id_key" ON "wishlist_items"("creator_id", "variant_id");
CREATE INDEX "wishlist_items_creator_id_sort_order_idx" ON "wishlist_items"("creator_id", "sort_order");
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creator_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "digital_assets" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "digital_assets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "digital_assets_product_id_key" ON "digital_assets"("product_id");
ALTER TABLE "digital_assets" ADD CONSTRAINT "digital_assets_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "public_ref" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "contact_phone" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "subtotal_paise" INTEGER NOT NULL,
    "shipping_paise" INTEGER NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "payment_expires_at" TIMESTAMP(3) NOT NULL,
    "checkout_attempt" INTEGER NOT NULL DEFAULT 0,
    "channel" TEXT NOT NULL DEFAULT 'web',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "orders_public_ref_key" ON "orders"("public_ref");
CREATE INDEX "orders_buyer_id_created_at_idx" ON "orders"("buyer_id", "created_at");
CREATE INDEX "orders_creator_id_created_at_idx" ON "orders"("creator_id", "created_at");
CREATE INDEX "orders_status_payment_expires_at_idx" ON "orders"("status", "payment_expires_at");
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_nonneg" CHECK ("subtotal_paise" >= 0 AND "shipping_paise" >= 0 AND "total_paise" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creator_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "variant_name" TEXT NOT NULL,
    "image_url" TEXT,
    "product_type" "ProductType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_paise" INTEGER NOT NULL,
    "shipping_paise" INTEGER NOT NULL,
    "line_total_paise" INTEGER NOT NULL,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_shipping_nonneg" CHECK ("shipping_paise" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "inventory_reservations" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_reservations_order_item_id_key" ON "inventory_reservations"("order_item_id");
CREATE INDEX "inventory_reservations_status_idx" ON "inventory_reservations"("status");
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'CASHFREE',
    "provider_order_id" TEXT NOT NULL,
    "payment_session_id" TEXT,
    "provider_payment_id" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "amount_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payments_provider_order_id_key" ON "payments"("provider_order_id");
CREATE INDEX "payments_status_updated_at_idx" ON "payments"("status", "updated_at");
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount_paise" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT,
    "provider_event_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_events_provider_event_id_key" ON "payment_events"("provider_event_id");
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "order_item_id" TEXT,
    "provider_refund_id" TEXT,
    "amount_paise" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "refunds_provider_refund_id_key" ON "refunds"("provider_refund_id");
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "gifts" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "status" "GiftStatus" NOT NULL DEFAULT 'AWAITING_REDEMPTION',
    "opened_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "reminded_at" TIMESTAMP(3),
    "needs_refund" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gifts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gifts_order_item_id_key" ON "gifts"("order_item_id");
CREATE INDEX "gifts_recipient_id_created_at_idx" ON "gifts"("recipient_id", "created_at");
CREATE INDEX "gifts_buyer_id_created_at_idx" ON "gifts"("buyer_id", "created_at");
CREATE INDEX "gifts_status_expires_at_idx" ON "gifts"("status", "expires_at");
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "gift_events" (
    "id" TEXT NOT NULL,
    "gift_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gift_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "gift_events_gift_id_created_at_idx" ON "gift_events"("gift_id", "created_at");
ALTER TABLE "gift_events" ADD CONSTRAINT "gift_events_gift_id_fkey" FOREIGN KEY ("gift_id") REFERENCES "gifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Home',
    "line1" TEXT NOT NULL,
    "line2" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "country_code" TEXT NOT NULL DEFAULT 'IN',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "addresses_user_id_idx" ON "addresses"("user_id");
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "redemptions" (
    "id" TEXT NOT NULL,
    "gift_id" TEXT NOT NULL,
    "line1" TEXT NOT NULL DEFAULT '',
    "line2" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT '',
    "postal_code" TEXT NOT NULL DEFAULT '',
    "country_code" TEXT NOT NULL DEFAULT 'IN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "redemptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "redemptions_gift_id_key" ON "redemptions"("gift_id");
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_gift_id_fkey" FOREIGN KEY ("gift_id") REFERENCES "gifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "gift_id" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "carrier" TEXT,
    "tracking_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shipments_gift_id_key" ON "shipments"("gift_id");
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_gift_id_fkey" FOREIGN KEY ("gift_id") REFERENCES "gifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "shipment_events" (
    "id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "note" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "shipment_events_shipment_id_created_at_idx" ON "shipment_events"("shipment_id", "created_at");
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "digital_access" (
    "id" TEXT NOT NULL,
    "gift_id" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "digital_access_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "digital_access_gift_id_key" ON "digital_access"("gift_id");
ALTER TABLE "digital_access" ADD CONSTRAINT "digital_access_gift_id_fkey" FOREIGN KEY ("gift_id") REFERENCES "gifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "digital_downloads" (
    "id" TEXT NOT NULL,
    "access_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "digital_downloads_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "digital_downloads" ADD CONSTRAINT "digital_downloads_access_id_fkey" FOREIGN KEY ("access_id") REFERENCES "digital_access"("id") ON DELETE CASCADE ON UPDATE CASCADE;
