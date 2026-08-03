"use client";

import { Alert, Button, FormField, Modal } from "@waflo/ui";
import { Crop, ImagePlus, Upload } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, apiUrl } from "../lib/api-client";
import type { AssetCategory, AssetItem } from "./program-studio-types";

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
}: {
  organizationId: string;
  category: AssetCategory;
  label: string;
  assets: AssetItem[];
  selectedId?: string | null | undefined;
  onSelected: (assetId: string | null) => void;
  onUploaded: (asset: AssetItem) => void;
  ar: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 1, height: 1, zoom: 1 });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [showChoices, setShowChoices] = useState(!selectedId);
  const choices = useMemo(
    () => assets.filter((asset) => asset.category === category),
    [assets, category],
  );
  const selectedAsset = choices.find((asset) => asset.id === selectedId);

  function displayName(asset: AssetItem): string {
    if (ar && asset.source === "WAFLO_LIBRARY") return "رسم مدمج من Waflo";
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
          ? ar
            ? "تمت إعادة استخدام الأصل المطابق الموجود."
            : "The existing matching asset was reused."
          : asset.uploadDisposition === "RESTORED"
            ? ar
              ? "تمت استعادة الأصل المؤرشف وإصلاح ملفاته."
              : "The archived matching asset was restored and repaired."
            : asset.uploadDisposition === "REPAIRED"
              ? ar
                ? "تم إصلاح ملفات الأصل المطابق."
                : "The matching asset object set was repaired."
              : ar
                ? "تم رفع الأصل ومعالجته."
                : "The asset was uploaded and processed.",
      );
      setFile(null);
      setCrop({ x: 0, y: 0, width: 1, height: 1, zoom: 1 });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="studio-asset-picker" aria-label={label}>
      {uploadMessage ? <Alert tone="success" title={uploadMessage} /> : null}
      <div className="studio-section-heading">
        <div>
          <h4>{label}</h4>
          <p>
            {ar
              ? "اختر من مكتبة Waflo أو ارفع صورة PNG أو JPEG أو WebP."
              : "Choose from the Waflo library or upload PNG, JPEG, or WebP."}
          </p>
        </div>
        {selectedAsset ? (
          <Button type="button" variant="ghost" onClick={() => setShowChoices((open) => !open)}>
            {showChoices ? (ar ? "إخفاء الخيارات" : "Hide options") : ar ? "تغيير" : "Change"}
          </Button>
        ) : null}
        <input
          ref={fileInput}
          className="wf-sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label={`${label} ${ar ? "رفع صورة" : "image upload"}`}
          onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
        />
      </div>
      {selectedAsset ? (
        <div className="studio-asset-current">
          <AssetThumbnail asset={selectedAsset} label={label} />
          <span>
            <small>{ar ? "المستخدم حاليًا" : "Currently used"}</small>
            <strong>{displayName(selectedAsset)}</strong>
            <small>
              {selectedAsset.source === "WAFLO_LIBRARY"
                ? ar
                  ? "مكتبة Waflo"
                  : "Waflo library"
                : ar
                  ? "تصميم مرفوع"
                  : "Uploaded artwork"}
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
          {category === "LOGO"
            ? ar
              ? "إضافة شعار"
              : "Add logo"
            : ar
              ? "اختيار رسم أو رفع تصميمك"
              : "Choose artwork or upload your own"}
        </button>
      )}
      {showChoices ? (
        <div className="studio-asset-library">
          {choices.length ? (
            <>
              <span className="studio-asset-library__label">
                {ar ? "الاختيار من المكتبة" : "Choose from library"}
              </span>
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
                      {asset.source === "WAFLO_LIBRARY"
                        ? ar
                          ? "مكتبة Waflo"
                          : "Waflo library"
                        : ar
                          ? "مرفوع"
                          : "Uploaded"}
                    </small>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {selectedAsset || choices.length ? (
            <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()}>
              <Upload size={16} />
              {ar ? "رفع تصميمك" : "Upload your own"}
            </Button>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={Boolean(file)}
        title={ar ? "قص الصورة بأمان" : "Crop image safely"}
        onClose={() => setFile(null)}
      >
        {previewUrl ? (
          <div className="studio-crop-layout">
            <div className="studio-crop-preview">
              <Image
                src={previewUrl}
                alt={ar ? "معاينة القص" : "Crop preview"}
                width={520}
                height={360}
                unoptimized
                onLoad={(event) =>
                  setNaturalSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                style={{
                  transform: `scale(${crop.zoom}) translate(${crop.x * -20}%, ${crop.y * -20}%)`,
                }}
              />
              <span className="studio-crop-safe-area" aria-hidden="true" />
            </div>
            <div className="studio-crop-controls">
              <p className="field-help">
                <Crop size={15} />
                {naturalSize.width} × {naturalSize.height}px ·{" "}
                {naturalSize.width < 256 || naturalSize.height < 256
                  ? ar
                    ? "الدقة منخفضة لختم واضح."
                    : "Resolution is low for a crisp stamp."
                  : ar
                    ? "الدقة مناسبة."
                    : "Resolution looks good."}
              </p>
              <FormField label={ar ? "التكبير" : "Zoom"}>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.1}
                  value={crop.zoom}
                  onChange={(event) =>
                    setCrop((current) => ({ ...current, zoom: Number(event.target.value) }))
                  }
                />
              </FormField>
              <FormField label={ar ? "الموضع الأفقي" : "Horizontal position"}>
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={crop.x}
                  onChange={(event) =>
                    setCrop((current) => {
                      const x = Number(event.target.value);
                      return { ...current, x, width: 1 - x };
                    })
                  }
                />
              </FormField>
              <FormField label={ar ? "الموضع العمودي" : "Vertical position"}>
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={crop.y}
                  onChange={(event) =>
                    setCrop((current) => {
                      const y = Number(event.target.value);
                      return { ...current, y, height: 1 - y };
                    })
                  }
                />
              </FormField>
              {error ? <p className="wf-form-error">{error}</p> : null}
            </div>
          </div>
        ) : null}
        <div className="wf-dialog__actions">
          <Button type="button" variant="secondary" onClick={() => setFile(null)}>
            {ar ? "إلغاء" : "Cancel"}
          </Button>
          <Button type="button" onClick={() => void upload()} loading={uploading}>
            {ar ? "معالجة ورفع" : "Process and upload"}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
