-- NJ sales tax is 6.625%; numeric(5,2) rounded it to 6.63 on the invoice
-- while the tax amount stayed exact. Three decimals hold every US rate.
-- Applied to the live project on 19 September 2026.
ALTER TABLE invoices ALTER COLUMN tax_rate TYPE numeric(6,3);
