export type MapboxTokenStatus = "SET" | "UNSET" | "INVALID_FORMAT";

export interface CanonicalAddress {
  addressLine1?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
}

export const wafloMapStyleUrl = "mapbox://styles/mapbox/standard";
export const mapboxRtlTextPluginUrl =
  "https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.4.0/mapbox-gl-rtl-text.js";

/**
 * Mapbox Standard exposes these basemap color controls directly, which keeps the
 * branded map on Mapbox's maintained vector style without adding a second map
 * bundle or a brittle list of provider layer ids.
 */
export const wafloBasemapConfig = {
  lightPreset: "day",
  show3dObjects: false,
  showPedestrianRoads: true,
  showPlaceLabels: true,
  showPointOfInterestLabels: true,
  showRoadLabels: true,
  showTransitLabels: false,
  densityPointOfInterestLabels: 2,
  backgroundPointOfInterestLabels: "none",
  colorModePointOfInterestLabels: "single",
  colorLand: "#fffdfc",
  colorWater: "#eef4f5",
  colorGreenspace: "#f1f3e9",
  colorCommercial: "#fff5f1",
  colorEducation: "#fff8f4",
  colorMedical: "#fff0ec",
  colorIndustrial: "#f6f0ed",
  colorBuildings: "#f0e7e3",
  colorAdminBoundaries: "#d7bbb3",
  colorRoads: "#f2a187",
  colorTrunks: "#e86f4e",
  colorMotorways: "#ae3115",
  colorPlaceLabels: "#241916",
  colorRoadLabels: "#5e4640",
  colorPointOfInterestLabels: "#76584f",
  colorPlaceLabelHighlight: "#ae3115",
  colorPlaceLabelSelect: "#ae3115",
  colorBuildingHighlight: "#ffb39f",
  colorBuildingSelect: "#ff6b4a",
} as const;

const publicMapboxTokenPattern = /^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

export function classifyMapboxToken(value: string | undefined): MapboxTokenStatus {
  if (!value?.trim()) return "UNSET";
  return publicMapboxTokenPattern.test(value.trim()) ? "SET" : "INVALID_FORMAT";
}

export function asMapboxRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function mapboxNestedString(value: unknown, ...path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) current = asMapboxRecord(current)?.[key];
  return typeof current === "string" && current.trim() ? current.trim() : undefined;
}

export function mapboxFeatureCoordinates(
  feature: unknown,
): { latitude: number; longitude: number } | null {
  const record = asMapboxRecord(feature);
  const geometry = asMapboxRecord(record?.geometry);
  const rawCoordinates = geometry?.coordinates;
  if (
    Array.isArray(rawCoordinates) &&
    typeof rawCoordinates[0] === "number" &&
    typeof rawCoordinates[1] === "number"
  ) {
    return { longitude: rawCoordinates[0], latitude: rawCoordinates[1] };
  }
  const properties = asMapboxRecord(record?.properties);
  const coordinates = asMapboxRecord(properties?.coordinates);
  const longitude = coordinates?.longitude;
  const latitude = coordinates?.latitude;
  return typeof longitude === "number" && typeof latitude === "number"
    ? { longitude, latitude }
    : null;
}

export function canonicalAddressFromMapboxFeature(feature: unknown): CanonicalAddress {
  const properties = asMapboxRecord(asMapboxRecord(feature)?.properties);
  const context = asMapboxRecord(properties?.context);
  const featureType = mapboxNestedString(properties, "feature_type");
  const name =
    mapboxNestedString(properties, "name") ?? mapboxNestedString(properties, "name_preferred");
  const fullAddress =
    mapboxNestedString(properties, "full_address") ??
    mapboxNestedString(properties, "place_formatted");
  const countryCode = (
    mapboxNestedString(context, "country", "country_code") ??
    mapboxNestedString(properties, "context", "country", "country_code")
  )?.toLocaleUpperCase("en-US");
  const addressLine1 =
    featureType === "address" || featureType === "street" || featureType === "poi"
      ? (fullAddress ?? name)
      : undefined;
  const city =
    mapboxNestedString(context, "place", "name") ??
    mapboxNestedString(context, "locality", "name") ??
    (featureType === "place" || featureType === "locality" ? name : undefined);
  const region = mapboxNestedString(context, "region", "name");
  const postalCode = mapboxNestedString(context, "postcode", "name");
  return {
    ...(addressLine1 ? { addressLine1 } : {}),
    ...(city ? { city } : {}),
    ...(region ? { region } : {}),
    ...(postalCode ? { postalCode } : {}),
    ...(countryCode ? { countryCode } : {}),
  };
}

export function firstMapboxFeature(payload: unknown): unknown | null {
  const features = asMapboxRecord(payload)?.features;
  return Array.isArray(features) ? (features[0] ?? null) : null;
}
