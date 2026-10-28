// Crops a visible-tab screenshot to the picked element. Works in the
// background service worker (no DOM, no FileReader).

/** @param {ArrayBuffer | Uint8Array} buffer */
export function bytesToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * The part of the element that is on screen, in screenshot pixels. The scale
 * comes from the screenshot itself, so it is right on 1x, 2x and zoomed pages.
 */
export function cropRect(viewport, imageWidth) {
  const scale = imageWidth / viewport.innerWidth;
  const left = Math.max(0, viewport.x);
  const top = Math.max(0, viewport.y);
  const right = Math.min(viewport.innerWidth, viewport.x + viewport.width);
  const bottom = Math.min(viewport.innerHeight, viewport.y + viewport.height);
  return {
    x: Math.round(left * scale),
    y: Math.round(top * scale),
    width: Math.round((right - left) * scale),
    height: Math.round((bottom - top) * scale),
    partial: viewport.y < 0 || viewport.y + viewport.height > viewport.innerHeight || viewport.x < 0 || viewport.x + viewport.width > viewport.innerWidth,
  };
}

/** @returns {Promise<{ base64: string, width: number, height: number, partial: boolean }>} */
export async function cropScreenshot(dataUrl, viewport) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const rect = cropRect(viewport, bitmap.width);
  if (rect.width < 2 || rect.height < 2) throw new Error("The element is off screen. Scroll it into view and pick again.");

  const canvas = new OffscreenCanvas(rect.width, rect.height);
  canvas.getContext("2d").drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return { base64: bytesToBase64(await blob.arrayBuffer()), width: rect.width, height: rect.height, partial: rect.partial };
}
