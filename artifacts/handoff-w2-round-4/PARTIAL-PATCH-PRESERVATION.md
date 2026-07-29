# Partial PATCH preservation

`programUpdateSchema` remains intentionally partial. The service now uses one canonical
stored-version-to-mutable-input conversion, then overlays only fields supplied by the caller before
recreating draft children.

The conversion preserves:

- all English and Arabic program translations;
- all reward translations and redemption instructions;
- validity, manager approval, maximum redemptions, and reward visual overrides;
- all visual colors, selected assets, sizing, spacing, radius, and visibility options;
- complete Apple and Google preview configuration;
- layout type and layout configuration;
- W2-stable StampRule policy defaults;
- participating locations;
- template code/version, editing mode, and change summary.

The HTTP regression creates non-default nested values, performs an internal-name-only PATCH with the
current revision, reloads the draft, and confirms omitted nested values are semantically unchanged.
The same canonical conversion is also used when a draft is created from a published version.

