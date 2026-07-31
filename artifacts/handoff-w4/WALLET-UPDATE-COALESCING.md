# Wallet update coalescing

Visible loyalty changes queue Wallet state work in the commit transaction. Apple/Google provider
calls occur later, so failure does not undo the ledger. State changes coalesce idempotently while
Apple's global update sequence and Google's pinned Program Version identity remain intact.

