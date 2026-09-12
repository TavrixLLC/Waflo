-- Admin pricing operations need an explicit, Waflo-owned market currency and a
-- short-lived sensitive-action proof bound to the existing Admin session.
-- Existing regional markets are deliberately left NULL: inferring a market
-- currency from historical prices would rewrite policy by guesswork.
ALTER TABLE "pricing_markets"
  ADD COLUMN "configured_currency" CHAR(3);

UPDATE "pricing_markets"
SET "configured_currency" = 'USD'
WHERE "kind" = 'GLOBAL' AND "code" = 'GLOBAL' AND "configured_currency" IS NULL;

ALTER TABLE "admin_sessions"
  ADD COLUMN "pricing_reauthenticated_at" TIMESTAMPTZ(6);
