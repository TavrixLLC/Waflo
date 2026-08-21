import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateBusinessCoordinate } from "../../apps/api/src/locations/location-coordinate";
import {
  canonicalAddressFromMapboxFeature,
  classifyMapboxToken,
  mapboxRtlTextPluginUrl,
  wafloBasemapConfig,
  wafloMapStyleUrl,
} from "../../apps/merchant-dashboard/components/location-mapbox";
import { classifyPublicMapboxToken, parseEnvironment } from "../../packages/config/src/index";
import {
  locationCoordinateSchema,
  locationSchema,
  locationUpdateSchema,
} from "../../packages/contracts/src/index";

const exactLocation = {
  name: "Mansour branch",
  countryCode: "IQ",
  timezone: "Asia/Baghdad",
  latitude: 33.3152,
  longitude: 44.3661,
  coordinatesConfirmed: true,
} as const;

describe("Mapbox-backed exact business location contract", () => {
  it("does not allow a new location without an exact confirmed coordinate", () => {
    expect(() =>
      locationSchema.parse({
        name: "Main branch",
        countryCode: "IQ",
        timezone: "Asia/Baghdad",
      }),
    ).toThrow();
    expect(() => locationSchema.parse({ ...exactLocation, coordinatesConfirmed: false })).toThrow();
    expect(locationSchema.parse(exactLocation)).toMatchObject(exactLocation);
  });

  it("requires paired, finite, explicitly confirmed coordinates on edits", () => {
    expect(() => locationUpdateSchema.parse({ latitude: 33.3 })).toThrow();
    expect(() => locationUpdateSchema.parse({ latitude: 33.3, longitude: 44.4 })).toThrow();
    expect(() =>
      locationUpdateSchema.parse({
        latitude: Number.NaN,
        longitude: 44.4,
        coordinatesConfirmed: true,
      }),
    ).toThrow();
    expect(
      locationUpdateSchema.parse({
        latitude: 33.3,
        longitude: 44.4,
        coordinatesConfirmed: true,
      }),
    ).toMatchObject({ latitude: 33.3, longitude: 44.4, coordinatesConfirmed: true });
  });

  it("validates coordinate bounds independently of any provider response", () => {
    expect(locationCoordinateSchema.parse({ latitude: -90, longitude: 180 })).toEqual({
      latitude: -90,
      longitude: 180,
    });
    expect(() => locationCoordinateSchema.parse({ latitude: 90.1, longitude: 44 })).toThrow();
    expect(() => locationCoordinateSchema.parse({ latitude: 33, longitude: -180.1 })).toThrow();
  });

  it("derives a canonical IANA timezone server-side from the confirmed point", () => {
    expect(validateBusinessCoordinate(33.3152, 44.3661)).toEqual({
      latitude: 33.3152,
      longitude: 44.3661,
      timezone: "Asia/Baghdad",
    });
    expect(validateBusinessCoordinate(40.7128, -74.006).timezone).toBe("America/New_York");
    expect(() => validateBusinessCoordinate(91, 44)).toThrowError(
      "Choose a valid business location on the map.",
    );
  });

  it("normalizes address fields without retaining Mapbox response JSON or feature IDs", () => {
    const address = canonicalAddressFromMapboxFeature({
      properties: {
        mapbox_id: "provider-only-id",
        feature_type: "address",
        name: "14 Street",
        full_address: "14 Street, Baghdad, Iraq",
        context: {
          place: { name: "Baghdad" },
          region: { name: "Baghdad Governorate" },
          postcode: { name: "10001" },
          country: { country_code: "iq" },
        },
      },
    });
    expect(address).toEqual({
      addressLine1: "14 Street, Baghdad, Iraq",
      city: "Baghdad",
      region: "Baghdad Governorate",
      postalCode: "10001",
      countryCode: "IQ",
    });
    expect(address).not.toHaveProperty("mapbox_id");
  });

  it("classifies only browser-safe public token shapes and never returns the value", () => {
    for (const classify of [classifyMapboxToken, classifyPublicMapboxToken]) {
      expect(classify(undefined)).toBe("UNSET");
      expect(classify("")).toBe("UNSET");
      expect(classify("sk.secret.secret")).toBe("INVALID_FORMAT");
      expect(classify("not-a-token")).toBe("INVALID_FORMAT");
      expect(classify("pk.public_segment.signature_segment")).toBe("SET");
    }
    expect(() =>
      parseEnvironment({
        NODE_ENV: "development",
        DEPLOYMENT_ENVIRONMENT: "development",
        NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: "sk.secret.secret",
      } as NodeJS.ProcessEnv),
    ).toThrow(/NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN/u);
  });

  it("keeps the Mapbox SDK behind a dynamic picker import path", () => {
    const picker = readFileSync(
      join(process.cwd(), "apps/merchant-dashboard/components/location-map-picker.tsx"),
      "utf8",
    );
    const shell = readFileSync(
      join(process.cwd(), "apps/merchant-dashboard/components/dashboard.tsx"),
      "utf8",
    );
    expect(picker).toContain('import("mapbox-gl")');
    expect(picker).not.toMatch(/^import mapboxgl from "mapbox-gl";/mu);
    expect(shell).not.toContain("mapbox-gl");
  });

  it("uses the maintained Mapbox basemap with an explicit Waflo color system", () => {
    expect(wafloMapStyleUrl).toBe("mapbox://styles/mapbox/standard");
    expect(wafloBasemapConfig).not.toHaveProperty("theme");
    expect(wafloBasemapConfig).toMatchObject({
      show3dObjects: false,
      colorLand: "#fffdfc",
      colorRoads: "#f2a187",
      colorTrunks: "#e86f4e",
      colorMotorways: "#ae3115",
      colorPlaceLabels: "#241916",
      colorRoadLabels: "#5e4640",
      colorModePointOfInterestLabels: "single",
      colorPointOfInterestLabels: "#76584f",
    });
  });

  it("keeps click, touch, current-location, RTL, reverse-geocode, and attribution behavior explicit", () => {
    const picker = readFileSync(
      join(process.cwd(), "apps/merchant-dashboard/components/location-map-picker.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      join(process.cwd(), "apps/merchant-dashboard/app/globals.css"),
      "utf8",
    );
    expect(picker).toContain("draggable: true");
    expect(picker).toContain('marker.on("dragend"');
    expect(picker).toContain('map.on("click"');
    expect(picker).toContain('event.key.startsWith("Arrow")');
    expect(picker).toContain('permanent: "true"');
    expect(picker).toContain("session_token");
    expect(picker).toContain("attributionControl: true");
    expect(picker).toContain("respectPrefersReducedMotion: true");
    expect(picker).toContain("wafloBasemapConfig");
    expect(picker).toContain("mapboxgl.setRTLTextPlugin");
    expect(mapboxRtlTextPluginUrl).toContain("mapbox-gl-rtl-text");
    expect(picker).toContain("coordinatesConfirmed: false");
    expect(picker).toContain("coordinatesConfirmed: true");
    expect(picker).toContain("navigator.geolocation.getCurrentPosition");
    expect(picker).toContain("enableHighAccuracy: true");
    expect(picker).not.toContain("console.");
    expect(styles).toContain(".location-map-dialog");
    expect(styles).toContain("height: 100dvh");
    expect(styles).toMatch(/\.location-map-marker\s*\{[^}]*position:\s*absolute/su);
    expect(styles).not.toMatch(/\.mapboxgl-ctrl-attrib\s*\{[^}]*display:\s*none/su);
  });

  it("allows user-initiated geolocation only in the merchant dashboard origin", () => {
    const dashboardConfig = readFileSync(
      join(process.cwd(), "apps/merchant-dashboard/next.config.ts"),
      "utf8",
    );
    expect(dashboardConfig).toContain("geolocation=(self)");
    expect(dashboardConfig).toContain("camera=()");
    expect(dashboardConfig).toContain("microphone=()");
  });
});
