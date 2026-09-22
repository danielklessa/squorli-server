import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Icon } from "./Icon";
import { t } from "./i18n";
import { cropRect, initialView, maxZoom, panBy, sliderToZoom, zoomAt, zoomToSlider, type CropImage, type CropRect, type CropView } from "./avatarCrop";

/** Long side of the bitmap the frame is drawn from: a phone photo is scaled down once instead of on every drag. */
const PREVIEW_MAX = 1024;
const KEY_STEP = 8;

/**
 * Crop editor for the profile picture: a square frame with a circle showing what others see. Drag with the mouse or a finger,
 * zoom with the slider, the wheel or two fingers, or use the keyboard (arrows, plus, minus). The geometry is `avatarCrop.ts`;
 * `onApply` gets the square in pixels of `source`, which the caller keeps open and closes.
 */
export function AvatarEditor({ source, busy, onApply, onCancel }: { source: ImageBitmap; busy: boolean; onApply: (crop: CropRect) => void; onCancel: () => void }) {
  const img: CropImage = { width: source.width, height: source.height };
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<ImageBitmap | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [view, setView] = useState<CropView>(() => initialView(img));
  const [ready, setReady] = useState(0);

  // A smaller copy for the frame when the source is large; the source itself otherwise.
  useEffect(() => {
    let cancelled = false; let own: ImageBitmap | null = null;
    const long = Math.max(source.width, source.height);
    (async () => {
      const bmp = long > PREVIEW_MAX
        ? await createImageBitmap(source, { resizeWidth: Math.round(source.width * PREVIEW_MAX / long), resizeHeight: Math.round(source.height * PREVIEW_MAX / long), resizeQuality: "high" })
        : source;
      if (cancelled) { if (bmp !== source) bmp.close(); return; }
      if (bmp !== source) own = bmp;
      preview.current = bmp; setReady((n) => n + 1);
    })();
    return () => { cancelled = true; preview.current = null; own?.close(); };
  }, [source]);

  // Draw the frame: the crop, the dimmed outside of the circle and its rim. Redrawn on every change and when the window resizes.
  useEffect(() => {
    const el = canvas.current; const bmp = preview.current;
    if (!el || !bmp) return;
    const draw = () => {
      const side = el.getBoundingClientRect().width; if (!side) return;
      const dpr = window.devicePixelRatio || 1;
      const px = Math.round(side * dpr);
      if (el.width !== px || el.height !== px) { el.width = px; el.height = px; }
      const ctx = el.getContext("2d"); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, side, side);
      const r = cropRect(img, view); const s = bmp.width / img.width;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, r.x * s, r.y * s, r.side * s, r.side * s, 0, 0, side, side);
      ctx.beginPath(); ctx.rect(0, 0, side, side); ctx.arc(side / 2, side / 2, side / 2, 0, Math.PI * 2, true);
      ctx.fillStyle = "rgba(4, 8, 18, 0.55)"; ctx.fill("evenodd");
      ctx.beginPath(); ctx.arc(side / 2, side / 2, side / 2 - 1, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)"; ctx.lineWidth = 1.5; ctx.stroke();
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [view, ready, img.width, img.height]);

  // The wheel zooms around the cursor; React's onWheel is passive, so the page would scroll as well.
  useEffect(() => {
    const el = canvas.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const focus = { fx: (e.clientX - rect.left) / rect.width, fy: (e.clientY - rect.top) / rect.height };
      setView((v) => zoomAt(img, v, Math.exp(-e.deltaY * 0.0015), focus));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [img.width, img.height]);

  const frameSide = () => canvas.current?.getBoundingClientRect().width || 1;
  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const map = pointers.current; const prev = map.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    if (map.size === 1) {
      setView((v) => panBy(img, v, now.x - prev.x, now.y - prev.y, frameSide()));
    } else if (map.size === 2) {
      // Pinch: the other finger stays, this one moved. Zoom by the change of their distance around their midpoint, then follow the midpoint.
      const other = [...map.entries()].find(([id]) => id !== e.pointerId)![1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y) || 1; const d1 = Math.hypot(now.x - other.x, now.y - other.y) || 1;
      const rect = e.currentTarget.getBoundingClientRect();
      const mid0 = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 }; const mid1 = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
      const focus = { fx: (mid0.x - rect.left) / rect.width, fy: (mid0.y - rect.top) / rect.height };
      setView((v) => panBy(img, zoomAt(img, v, d1 / d0, focus), mid1.x - mid0.x, mid1.y - mid0.y, rect.width));
    }
    map.set(e.pointerId, now);
  }
  function onPointerEnd(e: PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
  }
  function onKeyDown(e: KeyboardEvent<HTMLCanvasElement>) {
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP; const side = frameSide();
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[e.key];
    if (move) setView((v) => panBy(img, v, move[0], move[1], side));
    else if (e.key === "+" || e.key === "=") setView((v) => zoomAt(img, v, 1.2));
    else if (e.key === "-") setView((v) => zoomAt(img, v, 1 / 1.2));
    else return;
    e.preventDefault();
  }

  const zoomable = maxZoom(img) > 1;
  return (
    <div className="avatar-editor">
      <canvas ref={canvas} className="avatar-editor-frame" tabIndex={0} role="img" aria-label={t("profile.avatarFrame")}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onKeyDown={onKeyDown} />
      <label className="avatar-editor-zoom">
        <Icon name="zoom-out" />
        <input type="range" min={0} max={100} value={zoomToSlider(img, view.zoom)} disabled={!zoomable || busy} aria-label={t("profile.avatarZoom")}
          onChange={(e) => { const target = sliderToZoom(img, Number(e.target.value)); setView((v) => zoomAt(img, v, target / v.zoom)); }} />
        <Icon name="zoom-in" />
      </label>
      <span className="muted small">{t("profile.avatarEditHint")}</span>
      <div className="row">
        <button disabled={busy} onClick={() => onApply(cropRect(img, view))}><Icon name="check" /> {t("profile.avatarApply")}</button>
        <button className="secondary" disabled={busy} onClick={onCancel}>{t("common.cancel")}</button>
      </div>
    </div>
  );
}
