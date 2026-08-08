# Route matrix

All paths are locale-prefixed with `/en` or `/ar`.

| Merchant task | Route | Direct load / refresh | Failure behavior |
| --- | --- | --- | --- |
| Loyalty Cards Library | `/dashboard/programs` | Pass | Safe signed-in shell |
| Template Gallery | `/dashboard/programs/new` | Pass | Guided empty/error state |
| Card Builder | `/dashboard/programs/:id/edit` | Pass | Terminal load alert; no infinite loading |
| Studio Overview | `/dashboard/programs/:id` | Pass | Invalid ID resolves to safe not-found/error UI |
| How it works | `/dashboard/programs/:id/how-it-works` | Pass | Safe Studio fallback |
| Customers & locations | `/dashboard/programs/:id/customers-locations` | Pass | Safe Studio fallback |
| Test | `/dashboard/programs/:id/test` | Pass | Safe Studio fallback |
| Launch | `/dashboard/programs/:id/launch` | Pass | Safe Studio fallback |
| Settings | `/dashboard/programs/:id/settings` | Pass | Safe Studio fallback |

The catch-all dashboard route validates route shape and Studio area. Unexpected trailing segments return not found. Studio navigation updates the real URL, and focus moves to the routed area after navigation. Authentication and organization selection are resolved from server/API truth rather than prior SPA memory; tenant-bound API authorization remains unchanged.
