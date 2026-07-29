# Single-program merchant root

The customer merchant root now has three explicit states:

- zero renderable discoverable Programs: prepared/unavailable state;
- exactly one: safe redirect to `/join/{canonical-program-slug}`;
- multiple: chooser.

The redirect preserves explicit `tenant` and `lang` parameters and does not loop. Merchant-host discovery works for the local development hostname forms as well as query-tenant testing. Production still forbids query tenant overrides and local hostname suffixes.

A malformed historical pinned artwork entry cannot take every valid merchant Program offline: discovery omits only that unrenderable Program without substituting artwork, while its direct route still returns an explicit artwork-unavailable error.

Playwright proves Arabic/RTL query preservation in `03a-single-program-root-arabic.png`; the same test asserts the English `today.lvh.me` merchant-host form at its canonical URL. A companion fully published fixture proves multiple Programs retain the chooser.
