# Stripe Customer Portal Plan Policy

W1 uses Policy A: the Customer Portal cannot change subscription prices/plans.

Required Stripe Dashboard configuration for `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID`:

- Use a dedicated Waflo Customer Portal configuration.
- Keep invoice/payment-method/customer-information management enabled as needed.
- Disable the subscription feature that allows customers to switch subscription prices/plans.
- Deploy the configuration ID through `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID` whenever Stripe is enabled.

The API now rejects Portal creation when this configuration ID is absent. Webhook processing continues to validate that subscription metadata and the configured Stripe Price ID agree; a mismatch is treated as a provider/configuration failure, not silently accepted.
