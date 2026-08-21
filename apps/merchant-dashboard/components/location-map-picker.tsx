"use client";

import { countryOptions } from "@waflo/contracts";
import { contentLocaleForInterface, type InterfaceLocale, messages } from "@waflo/i18n";
import { Alert, Button, FormField, SearchableSelect, TextInput } from "@waflo/ui";
import { CheckCircle2, LoaderCircle, LocateFixed, MapPin, Search } from "lucide-react";
import type { Map as MapboxMap, Marker as MapboxMarker } from "mapbox-gl";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import { apiFetch } from "../lib/api-client";
import {
  asMapboxRecord as asRecord,
  type CanonicalAddress,
  canonicalAddressFromMapboxFeature,
  classifyMapboxToken,
  mapboxFeatureCoordinates as featureCoordinates,
  firstMapboxFeature as firstFeature,
  mapboxRtlTextPluginUrl,
  mapboxNestedString as nestedString,
  wafloBasemapConfig,
  wafloMapStyleUrl,
} from "./location-mapbox";

export interface LocationMapSelection {
  latitude: number | null;
  longitude: number | null;
  coordinatesConfirmed: boolean;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
  timezone: string;
}

interface SearchResult {
  id: string;
  source: "searchbox" | "geocoding";
  label: string;
  description: string;
  mapboxId?: string;
  latitude?: number;
  longitude?: number;
  feature?: unknown;
}

interface CoordinateResponse {
  latitude: number;
  longitude: number;
  timezone: string;
}

const defaultCenter: [number, number] = [44.3661, 33.3152];

const fastGeolocationOptions: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 5 * 60_000,
  timeout: 4_000,
};

const preciseGeolocationOptions: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 8_000,
};

function browserPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function placeMarker(
  map: MapboxMap,
  marker: MapboxMarker,
  latitude: number,
  longitude: number,
): void {
  // A custom Mapbox marker must have a coordinate before it enters the map DOM.
  // Otherwise its absolute-positioned element can appear at the container origin.
  marker.setLngLat([longitude, latitude]);
  if (!marker.getElement().isConnected) marker.addTo(map);
  marker.getElement().hidden = false;
}

function zoomForGeolocationAccuracy(accuracy: number): number {
  if (accuracy <= 40) return 18;
  if (accuracy <= 150) return 17;
  if (accuracy <= 500) return 15;
  return 13;
}

function displayAddress(
  value: LocationMapSelection,
  separator: string,
  unavailable: string,
): string {
  const parts = [value.addressLine1, value.city, value.region, value.countryCode].filter(Boolean);
  return parts.join(separator) || unavailable;
}

function createSessionToken(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function normalizeSearchBoxSuggestions(payload: unknown): SearchResult[] {
  const suggestions = asRecord(payload)?.suggestions;
  if (!Array.isArray(suggestions)) return [];
  return suggestions.flatMap((suggestion): SearchResult[] => {
    const record = asRecord(suggestion);
    const mapboxId = typeof record?.mapbox_id === "string" ? record.mapbox_id : undefined;
    const label =
      (typeof record?.name === "string" && record.name.trim()) ||
      (typeof record?.full_address === "string" && record.full_address.trim()) ||
      "";
    if (!mapboxId || !label) return [];
    const description =
      (typeof record?.place_formatted === "string" && record.place_formatted.trim()) ||
      (typeof record?.full_address === "string" && record.full_address.trim()) ||
      "";
    return [
      {
        id: `searchbox:${mapboxId}`,
        source: "searchbox",
        mapboxId,
        label,
        description,
      },
    ];
  });
}

function normalizeGeocodingFeatures(payload: unknown): SearchResult[] {
  const features = asRecord(payload)?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((feature, index): SearchResult[] => {
    const coordinates = featureCoordinates(feature);
    const properties = asRecord(asRecord(feature)?.properties);
    if (!coordinates || !properties) return [];
    const label =
      nestedString(properties, "name_preferred") ??
      nestedString(properties, "name") ??
      nestedString(properties, "full_address");
    if (!label) return [];
    return [
      {
        id: `geocoding:${nestedString(properties, "mapbox_id") ?? index}`,
        source: "geocoding",
        label,
        description:
          nestedString(properties, "full_address") ??
          nestedString(properties, "place_formatted") ??
          "",
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        feature,
      },
    ];
  });
}

export function LocationAddressFields({
  locale,
  value,
  onChange,
}: {
  locale: InterfaceLocale;
  value: LocationMapSelection;
  onChange: (value: LocationMapSelection) => void;
}) {
  const copy = messages[locale].onboarding.location;
  const contentLocale = contentLocaleForInterface(locale);
  const countries = useMemo(
    () =>
      countryOptions(contentLocale).map((country) => ({
        value: country.code,
        label: country.name,
      })),
    [contentLocale],
  );
  const update = (field: keyof LocationMapSelection) => (event: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [field]: event.currentTarget.value });

  return (
    <div className="location-address-fields">
      <FormField label={copy.address}>
        <TextInput
          name="addressLine1"
          value={value.addressLine1}
          onChange={update("addressLine1")}
          autoComplete="address-line1"
        />
      </FormField>
      <FormField label={copy.addressLine2}>
        <TextInput
          name="addressLine2"
          value={value.addressLine2}
          onChange={update("addressLine2")}
          autoComplete="address-line2"
        />
      </FormField>
      <div className="location-address-fields__grid">
        <FormField label={copy.city}>
          <TextInput
            name="city"
            value={value.city}
            onChange={update("city")}
            autoComplete="address-level2"
          />
        </FormField>
        <FormField label={copy.region}>
          <TextInput
            name="region"
            value={value.region}
            onChange={update("region")}
            autoComplete="address-level1"
          />
        </FormField>
        <FormField label={copy.postalCode}>
          <TextInput
            name="postalCode"
            value={value.postalCode}
            onChange={update("postalCode")}
            autoComplete="postal-code"
          />
        </FormField>
        <FormField label={copy.country} required>
          <SearchableSelect
            name="countryCode"
            options={countries}
            value={value.countryCode}
            onValueChange={(countryCode) => onChange({ ...value, countryCode })}
            placeholder={copy.searchCountries}
            required
          />
        </FormField>
      </div>
      <div className="location-timezone-row">
        <span>{copy.timezone}</span>
        <strong dir="ltr">{value.timezone || copy.timezonePending}</strong>
      </div>
    </div>
  );
}

export function LocationMapPicker({
  locale,
  value,
  onChange,
  headingLevel = 3,
}: {
  locale: InterfaceLocale;
  value: LocationMapSelection;
  onChange: (value: LocationMapSelection) => void;
  headingLevel?: 2 | 3;
}) {
  const copy = messages[locale].onboarding.location;
  const contentLocale = contentLocaleForInterface(locale);
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim() ?? "";
  const tokenStatus = classifyMapboxToken(token);
  const listboxId = useId();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerRef = useRef<MapboxMarker | null>(null);
  const valueRef = useRef(value);
  const updateCounterRef = useRef(0);
  const geolocationRequestRef = useRef(0);
  const sessionTokenRef = useRef(createSessionToken());
  const suppressNextSearchRef = useRef(false);
  const selectCoordinateRef = useRef<
    (latitude: number, longitude: number, preliminaryAddress?: CanonicalAddress) => Promise<void>
  >(() => Promise.resolve());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  async function reverseGeocode(latitude: number, longitude: number): Promise<CanonicalAddress> {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      language: contentLocale,
      permanent: "true",
      access_token: token,
    });
    const response = await fetch(`https://api.mapbox.com/search/geocode/v6/reverse?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("reverse-geocoding-unavailable");
    return canonicalAddressFromMapboxFeature(firstFeature(await response.json()));
  }

  async function selectCoordinate(
    latitude: number,
    longitude: number,
    preliminaryAddress: CanonicalAddress = {},
  ) {
    const updateId = ++updateCounterRef.current;
    const roundedLatitude = Number(latitude.toFixed(6));
    const roundedLongitude = Number(longitude.toFixed(6));
    const base = {
      ...valueRef.current,
      ...preliminaryAddress,
      latitude: roundedLatitude,
      longitude: roundedLongitude,
      timezone: "",
      coordinatesConfirmed: false,
    };
    valueRef.current = base;
    onChange(base);
    const map = mapRef.current;
    const marker = markerRef.current;
    if (map && marker) {
      placeMarker(map, marker, roundedLatitude, roundedLongitude);
    } else {
      marker?.setLngLat([roundedLongitude, roundedLatitude]);
    }
    setResolving(true);
    setError("");
    const [coordinateResult, addressResult] = await Promise.allSettled([
      apiFetch<CoordinateResponse>("/v1/location-tools/coordinate", {
        method: "POST",
        body: JSON.stringify({ latitude: roundedLatitude, longitude: roundedLongitude }),
      }),
      reverseGeocode(roundedLatitude, roundedLongitude),
    ]);
    if (updateId !== updateCounterRef.current) return;
    const next = {
      ...base,
      ...(addressResult.status === "fulfilled" ? addressResult.value : {}),
      ...(coordinateResult.status === "fulfilled"
        ? { timezone: coordinateResult.value.timezone }
        : {}),
    };
    valueRef.current = next;
    onChange(next);
    if (addressResult.status === "fulfilled") {
      const writtenAddress = displayAddress(next, locale === "en" ? ", " : "، ", "");
      if (writtenAddress && writtenAddress !== query) {
        suppressNextSearchRef.current = true;
        setQuery(writtenAddress);
      }
    }
    setResolving(false);
    if (coordinateResult.status === "rejected") {
      setError(copy.validationError);
    } else if (addressResult.status === "rejected") {
      setError(copy.addressRefreshError);
    }
  }

  selectCoordinateRef.current = selectCoordinate;

  useEffect(() => {
    if (tokenStatus !== "SET" || !mapContainerRef.current || mapRef.current) return;
    let active = true;
    let loaded = false;
    let clickHandler: ((event: { lngLat: { lat: number; lng: number } }) => void) | null = null;
    void import("mapbox-gl")
      .then((module) => {
        if (!active || !mapContainerRef.current) return;
        const mapboxgl = module.default;
        mapboxgl.accessToken = token;
        if (locale !== "en" && mapboxgl.getRTLTextPluginStatus() === "unavailable") {
          mapboxgl.setRTLTextPlugin(mapboxRtlTextPluginUrl, null, true);
        }
        const current = valueRef.current;
        const hasCoordinate = current.latitude !== null && current.longitude !== null;
        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: wafloMapStyleUrl,
          config: { basemap: { ...wafloBasemapConfig } },
          center: hasCoordinate
            ? [current.longitude as number, current.latitude as number]
            : defaultCenter,
          zoom: hasCoordinate ? 16 : 11,
          attributionControl: true,
          boxZoom: false,
          cooperativeGestures: false,
          doubleClickZoom: false,
          dragRotate: false,
          language: contentLocale,
          maxPitch: 0,
          pitchWithRotate: false,
          respectPrefersReducedMotion: true,
          scrollZoom: false,
          touchPitch: false,
        });
        map.touchZoomRotate.disableRotation();
        const markerElement = document.createElement("button");
        markerElement.type = "button";
        markerElement.className = "location-map-marker";
        markerElement.hidden = true;
        markerElement.setAttribute("role", "button");
        const markerBody = document.createElement("span");
        const markerBrand = document.createElement("img");
        markerBrand.src = "/brand/waflo-mark-primary.svg";
        markerBrand.alt = "";
        markerBrand.setAttribute("aria-hidden", "true");
        markerBody.append(markerBrand);
        markerElement.append(markerBody);
        markerElement.setAttribute("aria-label", copy.markerAria);
        markerElement.addEventListener("click", (event) => event.stopPropagation());
        markerElement.addEventListener("keydown", (event) => {
          if (!markerRef.current || !event.key.startsWith("Arrow")) return;
          event.preventDefault();
          geolocationRequestRef.current += 1;
          setLocating(false);
          const coordinate = markerRef.current.getLngLat();
          const step = event.shiftKey ? 0.0001 : 0.00001;
          if (event.key === "ArrowLeft") coordinate.lng -= step;
          if (event.key === "ArrowRight") coordinate.lng += step;
          if (event.key === "ArrowUp") coordinate.lat += step;
          if (event.key === "ArrowDown") coordinate.lat -= step;
          map.easeTo({ center: coordinate, duration: 180 });
          void selectCoordinateRef.current(coordinate.lat, coordinate.lng);
        });
        const marker = new mapboxgl.Marker({
          element: markerElement,
          draggable: true,
          anchor: "bottom",
        });
        markerRef.current = marker;
        if (hasCoordinate) {
          placeMarker(map, marker, current.latitude as number, current.longitude as number);
        }
        marker.on("dragend", () => {
          geolocationRequestRef.current += 1;
          setLocating(false);
          const coordinate = marker.getLngLat();
          void selectCoordinateRef.current(coordinate.lat, coordinate.lng);
        });
        map.addControl(
          new mapboxgl.NavigationControl({ showCompass: false }),
          locale === "en" ? "bottom-right" : "bottom-left",
        );
        clickHandler = (event) => {
          if (!markerRef.current) return;
          geolocationRequestRef.current += 1;
          setLocating(false);
          setResultsOpen(false);
          placeMarker(map, markerRef.current, event.lngLat.lat, event.lngLat.lng);
          void selectCoordinateRef.current(event.lngLat.lat, event.lngLat.lng);
        };
        map.on("click", clickHandler);
        map.on("load", () => {
          loaded = true;
          if (active) {
            const selected = valueRef.current;
            if (selected.latitude !== null && selected.longitude !== null) {
              placeMarker(map, marker, selected.latitude, selected.longitude);
            }
            setMapReady(true);
          }
        });
        map.on("error", () => {
          if (active && !loaded) {
            setError(copy.mapLoadError);
          }
        });
        mapRef.current = map;
      })
      .catch(() => {
        if (active) {
          setError(copy.mapLoadError);
        }
      });
    return () => {
      active = false;
      geolocationRequestRef.current += 1;
      setLocating(false);
      if (clickHandler && mapRef.current) mapRef.current.off("click", clickHandler);
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // The ref keeps form callbacks current without recreating the WebGL context.
  }, [contentLocale, copy, locale, token, tokenStatus]);

  useEffect(() => {
    if (suppressNextSearchRef.current) {
      suppressNextSearchRef.current = false;
      setResults([]);
      setSearching(false);
      return;
    }
    if (tokenStatus !== "SET" || query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSearching(true);
      const common = {
        q: query.trim(),
        access_token: token,
        language: contentLocale,
        limit: "6",
        ...(mapRef.current
          ? {
              proximity: `${mapRef.current.getCenter().lng.toFixed(6)},${mapRef.current
                .getCenter()
                .lat.toFixed(6)}`,
            }
          : {}),
        ...(value.countryCode ? { country: value.countryCode.toLocaleLowerCase("en-US") } : {}),
      };
      const searchBoxParams = new URLSearchParams({
        ...common,
        session_token: sessionTokenRef.current,
        types: "poi,address,street,place,locality",
      });
      const geocodingParams = new URLSearchParams({
        ...common,
        autocomplete: "true",
        permanent: "false",
        types: "address,street,place,locality,region,country",
      });
      void Promise.allSettled([
        fetch(`https://api.mapbox.com/search/searchbox/v1/suggest?${searchBoxParams}`, {
          signal: controller.signal,
        }).then(async (response) => (response.ok ? response.json() : null)),
        fetch(`https://api.mapbox.com/search/geocode/v6/forward?${geocodingParams}`, {
          signal: controller.signal,
        }).then(async (response) => (response.ok ? response.json() : null)),
      ]).then((responses) => {
        if (controller.signal.aborted) return;
        const searchBoxPayload = responses[0]?.status === "fulfilled" ? responses[0].value : null;
        const geocodingPayload = responses[1]?.status === "fulfilled" ? responses[1].value : null;
        if (!searchBoxPayload && !geocodingPayload) {
          setResults([]);
          setResultsOpen(true);
          setSearching(false);
          setError(copy.searchUnavailable);
          return;
        }
        const searchBox = searchBoxPayload ? normalizeSearchBoxSuggestions(searchBoxPayload) : [];
        const geocoding = geocodingPayload ? normalizeGeocodingFeatures(geocodingPayload) : [];
        const unique = new Map<string, SearchResult>();
        for (const result of [...searchBox, ...geocoding]) {
          const key = `${result.label}|${result.description}`.toLocaleLowerCase();
          if (!unique.has(key)) unique.set(key, result);
        }
        setResults(Array.from(unique.values()).slice(0, 8));
        setResultsOpen(true);
        setActiveIndex(0);
        setSearching(false);
        setError("");
      });
    }, 280);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [contentLocale, copy, query, token, tokenStatus, value.countryCode]);

  async function chooseResult(result: SearchResult) {
    geolocationRequestRef.current += 1;
    setLocating(false);
    const selectedQuery = [result.label, result.description].filter(Boolean).join(", ");
    if (selectedQuery !== query) {
      suppressNextSearchRef.current = true;
      setQuery(selectedQuery);
    }
    setResultsOpen(false);
    setError("");
    let latitude = result.latitude;
    let longitude = result.longitude;
    let feature = result.feature;
    if (result.source === "searchbox" && result.mapboxId) {
      setResolving(true);
      try {
        const params = new URLSearchParams({
          access_token: token,
          session_token: sessionTokenRef.current,
        });
        const response = await fetch(
          `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(result.mapboxId)}?${params}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (!response.ok) throw new Error("search-retrieve-unavailable");
        feature = firstFeature(await response.json());
        const coordinate = featureCoordinates(feature);
        latitude = coordinate?.latitude;
        longitude = coordinate?.longitude;
        sessionTokenRef.current = createSessionToken();
      } catch {
        setResolving(false);
        setError(copy.openResultError);
        return;
      }
    }
    if (latitude === undefined || longitude === undefined) {
      setResolving(false);
      setError(copy.resultMissingLocation);
      return;
    }
    const map = mapRef.current;
    if (map && markerRef.current) {
      placeMarker(map, markerRef.current, latitude, longitude);
      map.stop();
      map.easeTo({ center: [longitude, latitude], zoom: 17, duration: 320 });
    }
    // Search results are temporary discovery data. Only the permanent reverse-geocode
    // response may populate canonical fields that the merchant can save.
    await selectCoordinate(latitude, longitude);
  }

  async function chooseCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setError(copy.currentLocationUnavailable);
      return;
    }
    const requestId = ++geolocationRequestRef.current;
    setLocating(true);
    setResultsOpen(false);
    setError("");
    const errors: GeolocationPositionError[] = [];
    const fastRequest = browserPosition(fastGeolocationOptions).catch((locationError) => {
      errors.push(locationError);
      throw locationError;
    });
    const preciseRequest = browserPosition(preciseGeolocationOptions).catch((locationError) => {
      errors.push(locationError);
      throw locationError;
    });

    const applyPosition = (position: GeolocationPosition) => {
      if (requestId !== geolocationRequestRef.current) return;
      const map = mapRef.current;
      const marker = markerRef.current;
      if (!map || !marker) return;
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      placeMarker(map, marker, latitude, longitude);
      map.stop();
      map.easeTo({
        center: [longitude, latitude],
        zoom: zoomForGeolocationAccuracy(position.coords.accuracy),
        duration: 320,
      });
      void selectCoordinateRef.current(latitude, longitude);
    };

    try {
      const firstPosition = await Promise.any([fastRequest, preciseRequest]);
      if (requestId !== geolocationRequestRef.current) return;
      setLocating(false);
      if (!mapRef.current || !markerRef.current) {
        setError(copy.currentLocationUnavailable);
        return;
      }
      applyPosition(firstPosition);

      // Desktop browsers often return a quick network-based estimate first. Keep
      // listening to the parallel high-accuracy request and refine only when it is
      // materially better; any later manual map action invalidates this request.
      void preciseRequest
        .then((precisePosition) => {
          if (
            requestId === geolocationRequestRef.current &&
            precisePosition.coords.accuracy + 10 < firstPosition.coords.accuracy
          ) {
            applyPosition(precisePosition);
          }
        })
        .catch(() => undefined);
    } catch {
      if (requestId !== geolocationRequestRef.current) return;
      setLocating(false);
      if (errors.some((locationError) => locationError.code === locationError.PERMISSION_DENIED)) {
        setError(copy.currentLocationPermissionDenied);
      } else if (errors.every((locationError) => locationError.code === locationError.TIMEOUT)) {
        setError(copy.currentLocationTimeout);
      } else {
        setError(copy.currentLocationUnavailable);
      }
    }
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setResultsOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, results.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setResultsOpen(true);
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && resultsOpen && results[activeIndex]) {
      event.preventDefault();
      void chooseResult(results[activeIndex]);
    } else if (event.key === "Escape") {
      setResultsOpen(false);
    }
  }

  const canConfirm =
    value.latitude !== null && value.longitude !== null && Boolean(value.timezone) && !resolving;
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <section
      className="location-picker"
      data-mapbox-token-status={tokenStatus}
      data-resolving={resolving || locating || undefined}
      aria-busy={resolving || searching || locating}
      aria-labelledby={`${listboxId}-heading`}
    >
      <div className="location-picker__intro">
        <div>
          <span className="location-picker__step">{copy.exactLocation}</span>
          <Heading id={`${listboxId}-heading`}>{copy.placePin}</Heading>
          <p>{copy.description}</p>
        </div>
        {value.coordinatesConfirmed ? (
          <span className="location-picker__confirmed">
            <CheckCircle2 size={18} aria-hidden="true" />
            {copy.confirmed}
          </span>
        ) : null}
      </div>

      {tokenStatus !== "SET" ? (
        <Alert tone="warning" title={copy.unavailableTitle}>
          {copy.unavailableDescription}
        </Alert>
      ) : (
        <>
          <div className="location-picker__tools">
            <div className="location-search">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                className="wf-input location-search__input"
                value={query}
                placeholder={copy.searchPlaceholder}
                aria-label={copy.searchAria}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={resultsOpen}
                aria-controls={listboxId}
                aria-activedescendant={
                  resultsOpen && results[activeIndex] ? `${listboxId}-${activeIndex}` : undefined
                }
                onFocus={() => setResultsOpen(results.length > 0)}
                onChange={(event) => {
                  geolocationRequestRef.current += 1;
                  setLocating(false);
                  suppressNextSearchRef.current = false;
                  setQuery(event.currentTarget.value);
                  setResultsOpen(true);
                  setActiveIndex(0);
                }}
                onKeyDown={onSearchKeyDown}
              />
              {searching ? (
                <LoaderCircle className="location-search__spinner" aria-label={copy.searching} />
              ) : null}
              {resultsOpen ? (
                <div className="location-search__results" id={listboxId} role="listbox">
                  {results.length ? (
                    results.map((result, index) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === activeIndex}
                        data-active={index === activeIndex || undefined}
                        id={`${listboxId}-${index}`}
                        key={result.id}
                        tabIndex={-1}
                        onPointerDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => void chooseResult(result)}
                      >
                        <MapPin size={17} aria-hidden="true" />
                        <span>
                          <strong>{result.label}</strong>
                          {result.description ? <small>{result.description}</small> : null}
                        </span>
                      </button>
                    ))
                  ) : searching ? null : (
                    <p>{copy.noResults}</p>
                  )}
                </div>
              ) : null}
            </div>
            <Button
              type="button"
              variant="secondary"
              className="location-picker__geolocate"
              loading={locating}
              loadingLabel={copy.locatingCurrentLocation}
              disabled={!mapReady || resolving}
              onClick={() => void chooseCurrentLocation()}
            >
              <LocateFixed size={18} aria-hidden="true" />
              {copy.useCurrentLocation}
            </Button>
          </div>
          <div
            className="location-map-frame"
            data-ready={mapReady || undefined}
            data-has-selection={
              value.latitude !== null && value.longitude !== null ? true : undefined
            }
          >
            <section
              ref={mapContainerRef}
              className="location-map-canvas"
              aria-label={copy.mapAria}
            />
            {mapReady ? (
              <div className="location-map-instruction" aria-hidden="true">
                <MapPin size={16} />
                <span>{copy.placePin}</span>
              </div>
            ) : null}
            {!mapReady ? (
              <div className="location-map-loading" role="status">
                <LoaderCircle aria-hidden="true" />
                {copy.loadingMap}
              </div>
            ) : null}
          </div>
        </>
      )}

      {error ? <Alert tone="danger" title={error} /> : null}
      {value.latitude !== null && value.longitude !== null ? (
        <div className="location-picker__selection" aria-live="polite">
          <div className="location-picker__selection-copy">
            <span className="location-picker__selection-icon" aria-hidden="true">
              <MapPin size={18} />
            </span>
            <div>
              <span className="location-picker__selection-label">{copy.selectedAddress}</span>
              <strong>
                {displayAddress(value, locale === "en" ? ", " : "، ", copy.noWrittenAddress)}
              </strong>
              <small dir="ltr">
                {value.latitude.toFixed(6)}, {value.longitude.toFixed(6)} · {value.timezone || "—"}
              </small>
            </div>
          </div>
          <Button
            type="button"
            disabled={!canConfirm}
            loading={resolving}
            onClick={() => onChange({ ...value, coordinatesConfirmed: true })}
          >
            <MapPin size={17} aria-hidden="true" />
            {copy.confirmLocation}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
