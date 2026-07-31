# ADR 0033: Projection as derived state

Status: Accepted

Membership progress is a low-latency read projection with a source event and exact ledger
sequence. Database guards reject an unbacked version. Drift is rebuilt under a lock and
expected-version precondition.

