-- Packed weight and carton size, so a label can be bought for a box.
--
-- ShipStation (and every other carrier API) refuses to rate a shipment
-- without a weight. Nothing in the catalogue recorded one, which is the
-- single thing standing between the CRM and a real shipping integration.
--
-- Deliberately nullable rather than defaulted to zero. NULL means "nobody
-- has put this box on a scale yet", which is a different and far more
-- useful fact than "this box weighs nothing". The push to ShipStation can
-- then refuse a box it cannot rate, and say which one, instead of handing
-- a carrier a 0 lb parcel and getting a nonsense price back.
--
-- Weight is stored in whole ounces: it is the smallest unit any US carrier
-- prices on, it avoids carrying a float through the rating call, and both
-- pounds and grams convert out of it cleanly. Dimensions are inches, which
-- is what the carton is printed in and what ShipStation expects.

ALTER TABLE products ADD COLUMN IF NOT EXISTS ship_weight_oz integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ship_length_in numeric(6,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS ship_width_in numeric(6,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS ship_height_in numeric(6,2);

-- A typo of 5000 lb or a negative measurement is a data-entry slip, not a
-- parcel. Catch it at the column rather than at the carrier.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_ship_weight_check;
ALTER TABLE products ADD CONSTRAINT products_ship_weight_check
  CHECK (ship_weight_oz IS NULL OR (ship_weight_oz > 0 AND ship_weight_oz <= 80000));

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_ship_dimensions_check;
ALTER TABLE products ADD CONSTRAINT products_ship_dimensions_check
  CHECK (
    (ship_length_in IS NULL OR (ship_length_in > 0 AND ship_length_in <= 200))
    AND (ship_width_in IS NULL OR (ship_width_in > 0 AND ship_width_in <= 200))
    AND (ship_height_in IS NULL OR (ship_height_in > 0 AND ship_height_in <= 200))
  );

COMMENT ON COLUMN products.ship_weight_oz IS
  'Packed weight in whole ounces, box and filler included. NULL until someone weighs it.';
COMMENT ON COLUMN products.ship_length_in IS 'Outer carton length in inches.';
COMMENT ON COLUMN products.ship_width_in IS 'Outer carton width in inches.';
COMMENT ON COLUMN products.ship_height_in IS 'Outer carton height in inches.';
