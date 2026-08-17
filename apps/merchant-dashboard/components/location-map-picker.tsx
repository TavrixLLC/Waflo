"use client";

import type { Locale } from "@waflo/contracts";
import { countryOptions } from "@waflo/contracts";
import { Alert, Button, FormField, SearchableSelect, TextInput } from "@waflo/ui";
import { CheckCircle2, LoaderCircle, MapPin, Search } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Map as MapboxMap, Marker as MapboxMarker } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { apiFetch } from "../lib/api-client";
import {
  asMapboxRecord as asRecord,
  canonicalAddressFromMapboxFeature,
  classifyMapboxToken,
  firstMapboxFeature as firstFeature,
  mapboxFeatureCoordinates as featureCoordinates,
  mapboxNestedString as nestedString,
  type CanonicalAddress,
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

function displayAddress(value: LocationMapSelection, ar: boolean): string {
  const parts = [value.addressLine1, value.city, value.region, value.countryCode].filter(Boolean);
  return (
    parts.join(ar ? "، " : ", ") || (ar ? "لم يتوفر عنوان نصي" : "No written address available")
  );
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
  locale: Locale;
  value: LocationMapSelection;
  onChange: (value: LocationMapSelection) => void;
}) {
  const ar = locale === "ar";
  const countries = useMemo(
    () => countryOptions(locale).map((country) => ({ value: country.code, label: country.name })),
    [locale],
  );
  const update = (field: keyof LocationMapSelection) => (event: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [field]: event.currentTarget.value });

  return (
    <div className="location-address-fields">
      <FormField label={ar ? "العنوان" : "Address"}>
        <TextInput
          name="addressLine1"
          value={value.addressLine1}
          onChange={update("addressLine1")}
          autoComplete="address-line1"
        />
      </FormField>
      <FormField label={ar ? "تفاصيل إضافية (اختياري)" : "Address line 2 (optional)"}>
        <TextInput
          name="addressLine2"
          value={value.addressLine2}
          onChange={update("addressLine2")}
          autoComplete="address-line2"
        />
      </FormField>
      <div className="location-address-fields__grid">
        <FormField label={ar ? "المدينة" : "City"}>
          <TextInput
            name="city"
            value={value.city}
            onChange={update("city")}
            autoComplete="address-level2"
          />
        </FormField>
        <FormField label={ar ? "المحافظة / المنطقة" : "Region / state"}>
          <TextInput
            name="region"
            value={value.region}
            onChange={update("region")}
            autoComplete="address-level1"
          />
        </FormField>
        <FormField label={ar ? "الرمز البريدي" : "Postal code"}>
          <TextInput
            name="postalCode"
            value={value.postalCode}
            onChange={update("postalCode")}
            autoComplete="postal-code"
          />
        </FormField>
        <FormField label={ar ? "البلد" : "Country"} required>
          <SearchableSelect
            name="countryCode"
            options={countries}
            value={value.countryCode}
            onValueChange={(countryCode) => onChange({ ...value, countryCode })}
            placeholder={ar ? "ابحث عن بلد" : "Search countries"}
            required
          />
        </FormField>
      </div>
      <div className="location-timezone-row">
        <span>{ar ? "المنطقة الزمنية" : "Timezone"}</span>
        <strong dir="ltr">
          {value.timezone || (ar ? "تُحدد بعد اختيار الموقع" : "Set after map selection")}
        </strong>
      </div>
    </div>
  );
}

export function LocationMapPicker({
  locale,
  value,
  onChange,
}: {
  locale: Locale;
  value: LocationMapSelection;
  onChange: (value: LocationMapSelection) => void;
}) {
  const ar = locale === "ar";
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim() ?? "";
  const tokenStatus = classifyMapboxToken(token);
  const listboxId = useId();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerRef = useRef<MapboxMarker | null>(null);
  const valueRef = useRef(value);
  const updateCounterRef = useRef(0);
  const sessionTokenRef = useRef(createSessionToken());
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
  const [error, setError] = useState("");

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  async function reverseGeocode(latitude: number, longitude: number): Promise<CanonicalAddress> {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      language: locale,
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
    markerRef.current?.setLngLat([roundedLongitude, roundedLatitude]);
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
    setResolving(false);
    if (coordinateResult.status === "rejected") {
      setError(
        ar
          ? "تعذر التحقق من هذا الموقع. حرّك العلامة قليلاً وحاول مرة أخرى."
          : "We couldn't validate this location. Move the pin slightly and try again.",
      );
    } else if (addressResult.status === "rejected") {
      setError(
        ar
          ? "تم تحديد الموقع، لكن تعذر تحديث العنوان. راجع العنوان قبل التأكيد."
          : "The location is selected, but we couldn't update the address. Check it before confirming.",
      );
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
        const current = valueRef.current;
        const hasCoordinate = current.latitude !== null && current.longitude !== null;
        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: "mapbox://styles/mapbox/streets-v12",
          center: hasCoordinate
            ? [current.longitude as number, current.latitude as number]
            : defaultCenter,
          zoom: hasCoordinate ? 16 : 11,
          attributionControl: true,
          cooperativeGestures: true,
        });
        const markerElement = document.createElement("button");
        markerElement.type = "button";
        markerElement.className = "location-map-marker";
        markerElement.append(document.createElement("span"));
        markerElement.setAttribute(
          "aria-label",
          ar
            ? "موقع الفرع. استخدم مفاتيح الأسهم لتحريك العلامة بدقة."
            : "Branch location. Use the arrow keys to fine-tune the marker.",
        );
        markerElement.addEventListener("keydown", (event) => {
          if (!markerRef.current || !event.key.startsWith("Arrow")) return;
          event.preventDefault();
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
          marker.setLngLat([current.longitude as number, current.latitude as number]).addTo(map);
        }
        marker.on("dragend", () => {
          const coordinate = marker.getLngLat();
          void selectCoordinateRef.current(coordinate.lat, coordinate.lng);
        });
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
        clickHandler = (event) => {
          if (!markerRef.current) return;
          if (!markerRef.current.getElement().isConnected) markerRef.current.addTo(map);
          map.easeTo({ center: event.lngLat, duration: 180 });
          void selectCoordinateRef.current(event.lngLat.lat, event.lngLat.lng);
        };
        map.on("click", clickHandler);
        map.on("load", () => {
          loaded = true;
          if (active) setMapReady(true);
        });
        map.on("error", () => {
          if (active && !loaded) {
            setError(
              ar ? "تعذر تحميل الخريطة. حاول مرة أخرى." : "We couldn't load the map. Try again.",
            );
          }
        });
        mapRef.current = map;
      })
      .catch(() => {
        if (active) {
          setError(
            ar ? "تعذر تحميل الخريطة. حاول مرة أخرى." : "We couldn't load the map. Try again.",
          );
        }
      });
    return () => {
      active = false;
      if (clickHandler && mapRef.current) mapRef.current.off("click", clickHandler);
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // The ref keeps form callbacks current without recreating the WebGL context.
  }, [ar, token, tokenStatus]);

  useEffect(() => {
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
        language: locale,
        limit: "6",
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
          setError(
            ar
              ? "تعذر البحث عن المواقع الآن. تحقق من الاتصال وحاول مرة أخرى."
              : "Location search is unavailable. Check your connection and try again.",
          );
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
  }, [ar, locale, query, token, tokenStatus, value.countryCode]);

  async function chooseResult(result: SearchResult) {
    setQuery([result.label, result.description].filter(Boolean).join(", "));
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
        setError(
          ar ? "تعذر فتح نتيجة البحث. حاول مرة أخرى." : "We couldn't open that result. Try again.",
        );
        return;
      }
    }
    if (latitude === undefined || longitude === undefined) {
      setResolving(false);
      setError(
        ar
          ? "لا تحتوي هذه النتيجة على موقع دقيق."
          : "That result does not include an exact location.",
      );
      return;
    }
    const map = mapRef.current;
    if (map && markerRef.current) {
      if (!markerRef.current.getElement().isConnected) markerRef.current.addTo(map);
      map.easeTo({ center: [longitude, latitude], zoom: 17, duration: 320 });
    }
    // Search results are temporary discovery data. Only the permanent reverse-geocode
    // response may populate canonical fields that the merchant can save.
    await selectCoordinate(latitude, longitude);
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

  return (
    <section
      className="location-picker"
      data-mapbox-token-status={tokenStatus}
      aria-labelledby={`${listboxId}-heading`}
    >
      <div className="location-picker__intro">
        <div>
          <span className="location-picker__step">{ar ? "الموقع الدقيق" : "Exact location"}</span>
          <h3 id={`${listboxId}-heading`}>
            {ar ? "ضع العلامة على مدخل الفرع" : "Place the pin on the storefront"}
          </h3>
          <p>
            {ar
              ? "ابحث عن النشاط أو العنوان، ثم حرّك العلامة وحدد موقع الفرع بدقة على الخريطة."
              : "Search for the business or address, then move the pin to the exact entrance."}
          </p>
        </div>
        {value.coordinatesConfirmed ? (
          <span className="location-picker__confirmed">
            <CheckCircle2 size={18} aria-hidden="true" />
            {ar ? "تم تأكيد الموقع" : "Location confirmed"}
          </span>
        ) : null}
      </div>

      {tokenStatus !== "SET" ? (
        <Alert
          tone="warning"
          title={ar ? "الخريطة غير متاحة الآن" : "The map is unavailable right now"}
        >
          {ar
            ? "جرّب مرة أخرى لاحقاً. لن يتم حفظ فرع من دون تحديد موقعه بدقة."
            : "Try again later. A branch cannot be saved without an exact confirmed location."}
        </Alert>
      ) : (
        <>
          <div className="location-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              className="wf-input location-search__input"
              value={query}
              placeholder={ar ? "ابحث باسم النشاط أو العنوان" : "Search business or address"}
              aria-label={ar ? "البحث عن موقع الفرع" : "Search for the branch location"}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={resultsOpen}
              aria-controls={listboxId}
              aria-activedescendant={
                resultsOpen && results[activeIndex] ? `${listboxId}-${activeIndex}` : undefined
              }
              onFocus={() => setResultsOpen(results.length > 0)}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setResultsOpen(true);
                setActiveIndex(0);
              }}
              onKeyDown={onSearchKeyDown}
            />
            {searching ? (
              <LoaderCircle
                className="location-search__spinner"
                aria-label={ar ? "جارٍ البحث" : "Searching"}
              />
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
                  <p>
                    {ar
                      ? "لا توجد نتائج. جرّب كتابة عنوان مختلف."
                      : "No results. Try a different address."}
                  </p>
                )}
              </div>
            ) : null}
          </div>
          <div className="location-map-frame" data-ready={mapReady || undefined}>
            <section
              ref={mapContainerRef}
              className="location-map-canvas"
              aria-label={ar ? "خريطة اختيار موقع الفرع" : "Branch location selection map"}
            />
            {!mapReady ? (
              <div className="location-map-loading" role="status">
                <LoaderCircle aria-hidden="true" />
                {ar ? "جارٍ تحميل الخريطة" : "Loading map"}
              </div>
            ) : null}
          </div>
        </>
      )}

      {error ? <Alert tone="danger" title={error} /> : null}
      {value.latitude !== null && value.longitude !== null ? (
        <div className="location-picker__selection" aria-live="polite">
          <div>
            <span>{ar ? "العنوان المحدد" : "Selected address"}</span>
            <strong>{displayAddress(value, ar)}</strong>
            <small dir="ltr">
              {value.latitude.toFixed(6)}, {value.longitude.toFixed(6)} · {value.timezone || "—"}
            </small>
          </div>
          <Button
            type="button"
            disabled={!canConfirm}
            loading={resolving}
            onClick={() => onChange({ ...value, coordinatesConfirmed: true })}
          >
            <MapPin size={17} aria-hidden="true" />
            {ar ? "تأكيد هذا الموقع" : "Confirm this location"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
