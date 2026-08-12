/**
 * Multi-step codec orchestration shared by the main-thread pipeline and the
 * worker, so the two paths can't diverge on the parts that actually have steps:
 * the PNG encode (posterize → encode → optimize) and the resize. Trivial
 * single-call encodes (JPEG, AVIF) stay inline at the call sites — there is
 * nothing to share. Codec callables are injected: the main-thread path passes a
 * loaded `Codecs` bundle, the worker passes its lazily-imported jSquash module
 * functions. Returns a raw `ArrayBuffer`; wrapping in a `Blob` is the caller's
 * job (the worker transfers buffers, the main thread builds blobs directly).
 */
import { calcResizeDimensions, posterizeRgb } from "./image-ops";

/** OxiPNG optimization level applied after the PNG encode on every path. */
export const OXIPNG_LEVEL = 3;

type PngEncodeFn = (data: ImageData) => Promise<ArrayBuffer>;
type OxipngFn = (
	data: ArrayBuffer,
	opts?: { level?: number },
) => Promise<ArrayBuffer>;
type ResizeFn = (
	data: ImageData,
	opts: { width: number; height: number },
) => Promise<ImageData>;

/**
 * Resize so the longest edge ≤ `maxEdge`; `null` keeps full size. The resize
 * codec is fetched lazily via `getResize` — only when a downscale is actually
 * needed — so callers that never downscale never pay the WASM load.
 */
export async function resizeToMaxEdge(
	getResize: () => Promise<ResizeFn>,
	source: ImageData,
	maxEdge: number | null,
): Promise<{ data: ImageData; resized: boolean }> {
	if (maxEdge === null) return { data: source, resized: false };
	const target = calcResizeDimensions(source.width, source.height, maxEdge);
	if (!target.needsResize) return { data: source, resized: false };
	const resize = await getResize();
	const data = await resize(source, {
		width: target.width,
		height: target.height,
	});
	return { data, resized: true };
}

/**
 * Posterize to `quality` color depth, encode as PNG, then OxiPNG-optimize.
 * Single source of truth for the lossy-PNG path on both threads — previously
 * the main thread used `canvas.toBlob` while the worker used jSquash, producing
 * different bytes for the same input.
 */
export async function encodePngBuffer(
	pngEncode: PngEncodeFn,
	oxipng: OxipngFn,
	data: ImageData,
	quality: number,
): Promise<ArrayBuffer> {
	const reduced = posterizeRgb(data, quality);
	const raw = await pngEncode(reduced);
	return oxipng(raw, { level: OXIPNG_LEVEL });
}
