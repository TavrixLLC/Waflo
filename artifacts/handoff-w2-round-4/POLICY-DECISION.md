# W2 policy configuration decision

Round 4 selected **Option B: formal policy-execution deferral to W4**.

The canonical decision is:

`docs/adr/ADR-W2-POLICY-EXECUTION-DEFERRED-TO-W4.md`

The typed backlog contract is:

`packages/contracts/src/w4-policy-backlog.ts`

W2 and W3-facing published configuration use stable defaults only:

- one stamp per qualifying action;
- maximum five stamps per synthetic Test Mode operation;
- no per-customer daily limit;
- no minimum purchase amount or currency;
- final reward redemption resets the current cycle.

The Studio explicitly states that configurable daily limits, purchase thresholds, and alternate
reset behavior are not active in W2. W4 owns their validation, persistence, production enforcement,
and customer-facing claims. No W3 behavior is claimed or implemented.

