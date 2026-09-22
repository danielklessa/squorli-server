/**
 * Geometry of the avatar crop editor, pure and tested. The user sees a square frame; the image is shown so that at zoom 1 its
 * short side fills the frame (the centered square of before). A `CropView` is the zoom and the center of the crop in image
 * pixels; `cropRect` turns it into the square that is cut out. The same file lives on the directory's account page
 * (`../squorli-directory/apps/directory/web/avatarCrop.ts`): change both together.
 */
export type CropImage = { width: number; height: number };
export type CropView = { zoom: number; cx: number; cy: number };
export type CropRect = { x: number; y: number; side: number };

/** Zoom relative to the fitted state; capped so a tiny image cannot be blown up to nothing. */
export const CROP_MAX_ZOOM = 4;
const MIN_CROP_SIDE = 32;

export function maxZoom(img: CropImage): number {
  return Math.max(1, Math.min(CROP_MAX_ZOOM, Math.min(img.width, img.height) / MIN_CROP_SIDE));
}
export function cropSide(img: CropImage, zoom: number): number {
  return Math.min(img.width, img.height) / zoom;
}
export function initialView(img: CropImage): CropView {
  return { zoom: 1, cx: img.width / 2, cy: img.height / 2 };
}
/** Keep the zoom within its range and the crop inside the image. */
export function clampView(img: CropImage, view: CropView): CropView {
  const zoom = Math.min(maxZoom(img), Math.max(1, view.zoom));
  const half = cropSide(img, zoom) / 2;
  return { zoom, cx: Math.min(img.width - half, Math.max(half, view.cx)), cy: Math.min(img.height - half, Math.max(half, view.cy)) };
}
export function cropRect(img: CropImage, view: CropView): CropRect {
  const v = clampView(img, view);
  const side = cropSide(img, v.zoom);
  return { x: v.cx - side / 2, y: v.cy - side / 2, side };
}
/** Move the image by `dx`/`dy` frame pixels (dragging it to the right moves the crop to the left). */
export function panBy(img: CropImage, view: CropView, dx: number, dy: number, frameSide: number): CropView {
  const scale = cropSide(img, view.zoom) / frameSide;
  return clampView(img, { ...view, cx: view.cx - dx * scale, cy: view.cy - dy * scale });
}
/** Multiply the zoom by `factor`, keeping the image point under the focus (fractions 0..1 of the frame) where it is. */
export function zoomAt(img: CropImage, view: CropView, factor: number, focus: { fx: number; fy: number } = { fx: 0.5, fy: 0.5 }): CropView {
  const v = clampView(img, view);
  const zoom = Math.min(maxZoom(img), Math.max(1, v.zoom * factor));
  const side0 = cropSide(img, v.zoom); const side1 = cropSide(img, zoom);
  const px = v.cx - side0 / 2 + focus.fx * side0; const py = v.cy - side0 / 2 + focus.fy * side0;
  return clampView(img, { zoom, cx: px + side1 / 2 - focus.fx * side1, cy: py + side1 / 2 - focus.fy * side1 });
}
/** Slider position 0..100 <-> zoom (linear between 1 and the image's maximum). */
export function zoomToSlider(img: CropImage, zoom: number): number {
  const max = maxZoom(img);
  return max <= 1 ? 0 : Math.round(((zoom - 1) / (max - 1)) * 100);
}
export function sliderToZoom(img: CropImage, pos: number): number {
  return 1 + (Math.min(100, Math.max(0, pos)) / 100) * (maxZoom(img) - 1);
}
