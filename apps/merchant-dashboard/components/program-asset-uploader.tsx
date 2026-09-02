"use client";

import { type InterfaceLocale, localeRegistry } from "@waflo/i18n";
import { Alert, Button, FormField, Modal } from "@waflo/ui";
import { Crop, ImagePlus, Upload, ZoomIn, ZoomOut } from "lucide-react";
import Image from "next/image";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { ApiClientError, apiFetch, apiUrl } from "../lib/api-client";
import type { AssetCategory, AssetItem } from "./program-studio-types";

const maximumUploadBytes = 2 * 1024 * 1024;
const acceptedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const fullImageCrop = { x: 0, y: 0, width: 1, height: 1, zoom: 1 };
const initialCrop = { x: 1 / 24, y: 1 / 24, width: 11 / 12, height: 11 / 12, zoom: 12 / 11 };

type CropState = typeof fullImageCrop;
type CropDrag = {
  mode: "PAN" | "RESIZE";
  pointerX: number;
  pointerY: number;
  crop: CropState;
};

function defaultCropForCategory(category: AssetCategory): CropState {
  // A merchant logo is a reusable source asset. Do not silently remove its
  // edges before the merchant has chosen to crop it. Other artwork retains its
  // established visual-safe-area default.
  return category === "LOGO" ? { ...fullImageCrop } : { ...initialCrop };
}

function AssetThumbnail({ asset, label }: { asset: AssetItem; label: string }) {
  const [source, setSource] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void fetch(`${apiUrl}${asset.contentUrl}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((response) => {
        if (!response.ok) throw new Error("Asset preview unavailable");
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => {
        if (active) setSource("");
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset.contentUrl]);

  return source ? (
    <Image src={source} alt="" width={76} height={76} unoptimized />
  ) : (
    <span className="studio-asset-thumbnail-placeholder" role="img" aria-label={label}>
      <ImagePlus size={22} />
    </span>
  );
}

export function ProgramAssetPicker({
  organizationId,
  category,
  label,
  assets,
  selectedId,
  onSelected,
  onUploaded,
  ar,
  interfaceLocale,
}: {
  organizationId: string;
  category: AssetCategory;
  label: string;
  assets: AssetItem[];
  selectedId?: string | null | undefined;
  onSelected: (assetId: string | null) => void;
  onUploaded: (asset: AssetItem) => void;
  ar: boolean;
  interfaceLocale?: InterfaceLocale | undefined;
}) {
  const copy =
    localeRegistry[interfaceLocale ?? (ar ? "ar" : "en")].messages.merchant.assetUploader;
  const fileInput = useRef<HTMLInputElement>(null);
  const cropWorkspace = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<CropDrag | null>(null);
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchOrigin = useRef<{ distance: number; zoom: number } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [crop, setCrop] = useState<CropState>(() => defaultCropForCategory(category));
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [showChoices, setShowChoices] = useState(!selectedId);
  const choices = useMemo(
    () => assets.filter((asset) => asset.category === category),
    [assets, category],
  );
  const selectedAsset = choices.find((asset) => asset.id === selectedId);

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function cropForZoom(current: CropState, nextZoom: number): CropState {
    const zoom = clamp(nextZoom, 1, 4);
    const width = 1 / zoom;
    const height = 1 / zoom;
    const focalX = current.x + current.width / 2;
    const focalY = current.y + current.height / 2;
    return {
      x: clamp(focalX - width / 2, 0, 1 - width),
      y: clamp(focalY - height / 2, 0, 1 - height),
      width,
      height,
      zoom,
    };
  }

  function zoomTo(nextZoom: number): void {
    setCrop((current) => {
      return cropForZoom(current, nextZoom);
    });
  }

  function pointerDistance(): number | null {
    const [first, second] = [...activePointers.current.values()];
    if (!first || !second) return null;
    return Math.hypot(first.x - second.x, first.y - second.y);
  }

  function beginCropInteraction(event: PointerEvent<HTMLElement>, mode: CropDrag["mode"]): void {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragOrigin.current = {
      mode,
      pointerX: event.clientX,
      pointerY: event.clientY,
      crop,
    };
    const distance = pointerDistance();
    pinchOrigin.current = distance === null ? null : { distance, zoom: crop.zoom };
  }

  function moveCropInteraction(event: PointerEvent<HTMLElement>): void {
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pinchOrigin.current;
    const distance = pointerDistance();
    if (pinch && distance !== null) {
      zoomTo(pinch.zoom * (distance / pinch.distance));
      return;
    }
    const origin = dragOrigin.current;
    if (!origin) return;
    const bounds =
      cropWorkspace.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    const deltaX = (event.clientX - origin.pointerX) / bounds.width;
    const deltaY = (event.clientY - origin.pointerY) / bounds.height;
    if (origin.mode === "RESIZE") {
      const delta = Math.max(deltaX, deltaY);
      const maximum = Math.min(1 - origin.crop.x, 1 - origin.crop.y);
      const width = clamp(origin.crop.width + delta, 0.25, maximum);
      setCrop({ ...origin.crop, width, height: width, zoom: 1 / width });
      return;
    }
    setCrop((current) => ({
      ...current,
      x: clamp(origin.crop.x - deltaX * current.width, 0, 1 - current.width),
      y: clamp(origin.crop.y - deltaY * current.height, 0, 1 - current.height),
    }));
  }

  function endCropInteraction(event: PointerEvent<HTMLElement>): void {
    activePointers.current.delete(event.pointerId);
    if (activePointers.current.size < 2) pinchOrigin.current = null;
    if (activePointers.current.size === 0) dragOrigin.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function keyboardPan(event: KeyboardEvent<HTMLElement>): void {
    const movement = event.shiftKey ? 0.05 : 0.01;
    const delta = {
      ArrowLeft: [-movement, 0],
      ArrowRight: [movement, 0],
      ArrowUp: [0, -movement],
      ArrowDown: [0, movement],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    setCrop((current) => ({
      ...current,
      x: clamp(current.x + (delta[0] ?? 0), 0, 1 - current.width),
      y: clamp(current.y + (delta[1] ?? 0), 0, 1 - current.height),
    }));
  }

  function wheelZoom(event: WheelEvent<HTMLElement>): void {
    event.preventDefault();
    zoomTo(crop.zoom * (event.deltaY > 0 ? 0.9 : 1.1));
  }

  function displayName(asset: AssetItem): string {
    if (asset.source === "WAFLO_LIBRARY") return copy.embeddedWafloArtwork;
    const name = asset.originalFilename
      .replace(/\.[^.]+$/u, "")
      .replace(/[-_]v\d+$/iu, "")
      .replace(/[-_](?:filled|empty)$/iu, "")
      .replaceAll(/[-_]+/gu, " ")
      .trim();
    return name || label;
  }

  function choose(assetId: string | null): void {
    onSelected(assetId);
    setShowChoices(false);
  }

  function selectFile(selected: File | null): void {
    setError("");
    if (!selected) {
      setFile(null);
      return;
    }
    if (!acceptedImageTypes.has(selected.type)) {
      setError(copy.unsupportedType);
      return;
    }
    if (selected.size === 0 || selected.size > maximumUploadBytes) {
      setError(copy.fileTooLarge);
      return;
    }
    setCrop(defaultCropForCategory(category));
    setFile(selected);
  }

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const next = URL.createObjectURL(file);
    setPreviewUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError("");
    setUploadMessage("");
    try {
      const form = new FormData();
      form.append("metadata", JSON.stringify({ category, crop }));
      form.append("file", file, file.name);
      const asset = await apiFetch<AssetItem>(`/v1/organizations/${organizationId}/assets`, {
        method: "POST",
        body: form,
      });
      onUploaded(asset);
      onSelected(asset.id);
      setUploadMessage(
        asset.uploadDisposition === "REPLAYED"
          ? copy.reused
          : asset.uploadDisposition === "RESTORED"
            ? copy.restored
            : asset.uploadDisposition === "REPAIRED"
              ? copy.repaired
              : copy.uploadedProcessed,
      );
      setFile(null);
      setCrop(defaultCropForCategory(category));
    } catch (caught) {
      const requestReference =
        caught instanceof ApiClientError && caught.requestId
          ? ` ${copy.requestReference.replace("{requestId}", caught.requestId)}`
          : "";
      setError(
        caught instanceof ApiClientError &&
          ["ASSET_UPLOAD_INVALID", "ASSET_MULTIPART_INVALID"].includes(caught.code)
          ? copy.invalidFile
          : caught instanceof ApiClientError &&
              ["ASSET_UPLOAD_TOO_LARGE", "PAYLOAD_TOO_LARGE"].includes(caught.code)
            ? copy.fileTooLarge
            : caught instanceof ApiClientError && caught.code === "ASSET_PROCESSING_FAILED"
              ? copy.processingFailed
              : caught instanceof ApiClientError && caught.code === "ASSET_STORAGE_UNAVAILABLE"
                ? copy.storageUnavailable
                : caught instanceof ApiClientError &&
                    [
                      "AUTH_REQUIRED",
                      "SESSION_EXPIRED",
                      "UNAUTHORIZED",
                      "FORBIDDEN",
                      "CSRF_REJECTED",
                      "CSRF_INVALID",
                      "CSRF_TOKEN_INVALID",
                    ].includes(caught.code)
                  ? copy.sessionExpired
                  : caught instanceof ApiClientError && caught.code === "NETWORK_ERROR"
                    ? copy.networkError
                    : `${copy.uploadError}${requestReference}`,
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="studio-asset-picker" aria-label={label}>
      {uploadMessage ? <Alert tone="success" title={uploadMessage} /> : null}
      {error && !file ? <Alert tone="danger" title={error} /> : null}
      <div className="studio-section-heading">
        <div>
          <h4>{label}</h4>
          <p>{copy.guidance}</p>
        </div>
        {selectedAsset ? (
          <Button type="button" variant="ghost" onClick={() => setShowChoices((open) => !open)}>
            {showChoices ? copy.hideOptions : copy.change}
          </Button>
        ) : null}
        <input
          ref={fileInput}
          className="wf-sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label={`${label} ${copy.imageUpload}`}
          onChange={(event) => {
            selectFile(event.currentTarget.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
      </div>
      {selectedAsset ? (
        <div className="studio-asset-current">
          <AssetThumbnail asset={selectedAsset} label={label} />
          <span>
            <small>{copy.currentlyUsed}</small>
            <strong>{displayName(selectedAsset)}</strong>
            <small>
              {selectedAsset.source === "WAFLO_LIBRARY" ? copy.wafloLibrary : copy.uploadedArtwork}
            </small>
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="studio-asset-empty"
          onClick={() => fileInput.current?.click()}
        >
          <ImagePlus size={24} />
          {category === "LOGO" ? copy.addLogo : copy.chooseArtwork}
        </button>
      )}
      {showChoices ? (
        <div className="studio-asset-library">
          {choices.length ? (
            <>
              <span className="studio-asset-library__label">{copy.chooseFromLibrary}</span>
              <div className="studio-asset-grid">
                {choices.map((asset) => (
                  <button
                    type="button"
                    key={asset.id}
                    className={`studio-asset-option ${selectedId === asset.id ? "studio-asset-option--selected" : ""}`}
                    onClick={() => choose(asset.id)}
                    aria-pressed={selectedId === asset.id}
                    aria-label={`${label}: ${displayName(asset)}`}
                  >
                    <AssetThumbnail asset={asset} label={displayName(asset)} />
                    <span>{displayName(asset)}</span>
                    <small>
                      {asset.source === "WAFLO_LIBRARY" ? copy.wafloLibrary : copy.uploaded}
                    </small>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {selectedAsset || choices.length ? (
            <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()}>
              <Upload size={16} />
              {copy.uploadYourOwn}
            </Button>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={Boolean(file)}
        title={copy.cropSafely}
        className="studio-crop-dialog"
        description={copy.cropHelp}
        onClose={() => setFile(null)}
      >
        {previewUrl ? (
          <div className="studio-crop-layout">
            <div ref={cropWorkspace} className="studio-crop-workspace">
              <button
                type="button"
                className={`studio-crop-preview ${category === "LOGO" ? "studio-crop-preview--logo" : ""}`}
                aria-label={copy.cropArea}
                aria-describedby="studio-crop-instruction"
                style={
                  naturalSize.width && naturalSize.height
                    ? { aspectRatio: `${naturalSize.width} / ${naturalSize.height}` }
                    : undefined
                }
                onPointerDown={(event) => beginCropInteraction(event, "PAN")}
                onPointerMove={moveCropInteraction}
                onPointerUp={endCropInteraction}
                onPointerCancel={endCropInteraction}
                onLostPointerCapture={() => {
                  dragOrigin.current = null;
                  activePointers.current.clear();
                  pinchOrigin.current = null;
                }}
                onKeyDown={keyboardPan}
                onWheel={wheelZoom}
              >
                <Image
                  src={previewUrl}
                  alt=""
                  width={520}
                  height={360}
                  unoptimized
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                  onLoad={(event) =>
                    setNaturalSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                />
                <span
                  className="studio-crop-safe-area"
                  aria-hidden="true"
                  style={{
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.width * 100}%`,
                    height: `${crop.height * 100}%`,
                  }}
                />
                <span
                  id="studio-crop-instruction"
                  className="studio-crop-instruction"
                  aria-hidden="true"
                >
                  {copy.dragToReposition}
                </span>
              </button>
              <button
                type="button"
                className="studio-crop-handle"
                aria-label={`${copy.cropArea}: resize`}
                style={{
                  left: `${(crop.x + crop.width) * 100}%`,
                  top: `${(crop.y + crop.height) * 100}%`,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  beginCropInteraction(event, "RESIZE");
                }}
                onPointerMove={moveCropInteraction}
                onPointerUp={endCropInteraction}
                onPointerCancel={endCropInteraction}
                onLostPointerCapture={() => {
                  dragOrigin.current = null;
                  activePointers.current.clear();
                  pinchOrigin.current = null;
                }}
              />
            </div>
            <div className="studio-crop-controls">
              <p className="field-help">
                <Crop size={15} />
                {copy.sourceDimensions
                  .replace("{width}", String(naturalSize.width))
                  .replace("{height}", String(naturalSize.height))}{" "}
                ·{" "}
                {naturalSize.width < 256 || naturalSize.height < 256
                  ? copy.resolutionLow
                  : copy.resolutionGood}
              </p>
              <FormField label={copy.zoom}>
                <div className="studio-crop-zoom">
                  <Button
                    type="button"
                    variant="ghost"
                    className="studio-crop-zoom__button"
                    aria-label={copy.zoomOut}
                    title={copy.zoomOut}
                    disabled={crop.zoom <= 1}
                    onClick={() => zoomTo(crop.zoom - 0.2)}
                  >
                    <ZoomOut size={18} aria-hidden="true" />
                  </Button>
                  <input
                    type="range"
                    min={1}
                    max={4}
                    step={0.1}
                    value={crop.zoom}
                    aria-label={copy.zoom}
                    onChange={(event) => zoomTo(Number(event.target.value))}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="studio-crop-zoom__button"
                    aria-label={copy.zoomIn}
                    title={copy.zoomIn}
                    disabled={crop.zoom >= 4}
                    onClick={() => zoomTo(crop.zoom + 0.2)}
                  >
                    <ZoomIn size={18} aria-hidden="true" />
                  </Button>
                </div>
              </FormField>
              <div className="studio-crop-control-row">
                <p>{copy.cropHelp}</p>
                <Button type="button" variant="ghost" onClick={() => setCrop(fullImageCrop)}>
                  {copy.resetCrop}
                </Button>
              </div>
              <div
                className="studio-crop-result"
                role="img"
                aria-label={copy.cropPreview}
                style={
                  naturalSize.width && naturalSize.height
                    ? {
                        aspectRatio: `${naturalSize.width * crop.width} / ${naturalSize.height * crop.height}`,
                      }
                    : undefined
                }
              >
                <Image
                  src={previewUrl}
                  alt=""
                  width={naturalSize.width || 520}
                  height={naturalSize.height || 360}
                  unoptimized
                  draggable={false}
                  style={{
                    width: `${100 / crop.width}%`,
                    height: `${100 / crop.height}%`,
                    left: `${(-crop.x / crop.width) * 100}%`,
                    top: `${(-crop.y / crop.height) * 100}%`,
                  }}
                />
                <span>{copy.cropPreview}</span>
              </div>
              {error ? <p className="wf-form-error">{error}</p> : null}
            </div>
          </div>
        ) : null}
        <div className="wf-dialog__actions">
          <Button type="button" variant="secondary" onClick={() => setFile(null)}>
            {copy.cancel}
          </Button>
          <Button type="button" onClick={() => void upload()} loading={uploading}>
            {copy.processUpload}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
