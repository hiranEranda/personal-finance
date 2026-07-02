-- Migration 009: relax processed_deposit_files.transaction_id's FK
--
-- POST /api/funds replaces a fund's entire transaction set on every save
-- (delete all, reinsert fresh with new ids) — that's fine for transactions
-- themselves, but processed_deposit_files.transaction_id pointed at those
-- rows with no ON DELETE behavior, so any fund edit through the normal UI
-- hard-failed with a foreign key violation the moment that fund had any
-- deposit-parser-sourced transactions.
--
-- ON DELETE SET NULL (not CASCADE): losing the transaction_id link just means
-- we can no longer trace a row back to the specific transaction it produced —
-- acceptable. CASCADE would additionally delete the processed_deposit_files
-- row itself, which is the dedupe memory that stops a PDF being re-inserted
-- as a duplicate on the next sync. That property matters more than the trace
-- link, so it must survive a fund save untouched.

ALTER TABLE processed_deposit_files DROP CONSTRAINT processed_deposit_files_transaction_id_fkey;
ALTER TABLE processed_deposit_files
    ADD CONSTRAINT processed_deposit_files_transaction_id_fkey
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;
