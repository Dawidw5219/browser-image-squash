/**
 * Pure, worker-safe image primitives shared by the main-thread pipeline and
 * the encode worker. Everything here runs identically in a Window or a
 * DedicatedWorkerGlobalScope — no DOM-only access at module load, canvas work
 * goes through `createCanvas` which prefers `OffscreenCanvas`.
 *
 * Kept dependency-light on purpose: the published package copies this file
 * verbatim next to `worker.ts` so bundlers that resolve the literal worker URL
 * (Parcel) can still find it. Only `import type` may cross module boundaries
 * here (type imports are erased before resolution).
 */
import type { AlphaAnalysis } from "../types/squash";

/* ── Alpha analysis ─────────────────────────────────────── */

const ALPHA_THRESHOLD_RATIO = 0.05;

export function analyzeAlpha(imageData: ImageData): AlphaAnalysis {
	const data = imageData.data;
	const total = data.length / 4;
	const threshold = Math.max(1, Math.floor(total * ALPHA_THRESHOLD_RATIO));
	let nonOpaque = 0;
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] < 255) nonOpaque++;
	}
	return {
		nonOpaque,
		total,
		ratio: nonOpaque / total,
		isTransparent: nonOpaque > threshold,
	};
}

/* ── Resize math ────────────────────────────────────────── */

export function calcResizeDimensions(
	w: number,
	h: number,
	maxEdge: number,
): { width: number; height: number; needsResize: boolean } {
	const longest = Math.max(w, h);
	if (longest <= maxEdge) return { width: w, height: h, needsResize: false };
	const scale = maxEdge / longest;
	return {
		width: Math.round(w * scale),
		height: Math.round(h * scale),
		needsResize: true,
	};
}

/* ── Lossy PNG posterization ────────────────────────────── */

export function posterizeRgb(imageData: ImageData, quality: number): ImageData {
	if (quality >= 100) return imageData;
	const levels = Math.max(2, Math.round(2 + (quality / 100) * 30));
	const step = 255 / (levels - 1);
	const out = new Uint8ClampedArray(imageData.data);
	for (let i = 0; i < out.length; i += 4) {
		out[i] = Math.round(out[i] / step) * step;
		out[i + 1] = Math.round(out[i + 1] / step) * step;
		out[i + 2] = Math.round(out[i + 2] / step) * step;
	}
	return new ImageData(out, imageData.width, imageData.height);
}

/* ── EXIF orientation ───────────────────────────────────── */

/**
 * EXIF orientation handling — iPhone and most cameras tag the file with an
 * `Orientation` value (1–8) instead of physically rotating pixel data. We read
 * the tag, apply the rotation to the decoded ImageData, then strip metadata
 * (jSquash encoders never embed it, so output is always clean).
 *
 *   1  Normal               5  Mirror horizontal + rotate 270 CW
 *   2  Mirror horizontal    6  Rotate 90 CW
 *   3  Rotate 180           7  Mirror horizontal + rotate 90 CW
 *   4  Mirror vertical      8  Rotate 270 CW
 */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Read JPEG EXIF Orientation tag. Returns 1 (no rotation) if not found or
 * unparseable. Cheap — early-exits at the first APP1 marker, never touches
 * pixels (safe to call on the main thread).
 */
export function readJpegOrientation(buffer: ArrayBuffer): ExifOrientation {
	const v = new DataView(buffer);
	if (v.byteLength < 12 || v.getUint16(0) !== 0xffd8) return 1;

	let off = 2;
	while (off < v.byteLength - 10) {
		if (v.getUint8(off) !== 0xff) return 1;
		const marker = v.getUint8(off + 1);
		if (marker === 0xd9 || marker === 0xda) return 1; // EOI / SOS — out of EXIF region
		const segLen = v.getUint16(off + 2);

		if (marker === 0xe1) {
			// APP1 — check "Exif\0\0" signature
			const exifStart = off + 4;
			if (
				v.getUint32(exifStart) === 0x45786966 /* "Exif" */ &&
				v.getUint16(exifStart + 4) === 0x0000
			) {
				const tiffStart = exifStart + 6;
				const o = readOrientationFromTiff(v, tiffStart);
				if (o) return o;
			}
		}
		off += 2 + segLen;
	}
	return 1;
}

function readOrientationFromTiff(
	v: DataView,
	tiffStart: number,
): ExifOrientation | 0 {
	if (tiffStart + 8 > v.byteLength) return 0;
	const endian = v.getUint16(tiffStart);
	const little = endian === 0x4949; // "II"
	if (!little && endian !== 0x4d4d /* "MM" */) return 0;
	const magic = v.getUint16(tiffStart + 2, little);
	if (magic !== 0x002a) return 0;
	const ifdOffset = v.getUint32(tiffStart + 4, little);
	const ifdStart = tiffStart + ifdOffset;
	if (ifdStart + 2 > v.byteLength) return 0;
	const count = v.getUint16(ifdStart, little);
	for (let i = 0; i < count; i++) {
		const entry = ifdStart + 2 + i * 12;
		if (entry + 12 > v.byteLength) return 0;
		const tag = v.getUint16(entry, little);
		if (tag === 0x0112 /* Orientation */) {
			const value = v.getUint16(entry + 8, little);
			if (value >= 1 && value <= 8) return value as ExifOrientation;
			return 0;
		}
	}
	return 0;
}

/**
 * Apply EXIF orientation to ImageData. Returns a NEW ImageData with pixels in
 * the visually-correct orientation (dimensions swap for values 5–8). Returns
 * the input untouched for orientation 1 or when no 2D context is available.
 */
export function applyOrientation(
	source: ImageData,
	orientation: ExifOrientation,
): ImageData {
	if (orientation === 1) return source;

	const swap = orientation >= 5;
	const outW = swap ? source.height : source.width;
	const outH = swap ? source.width : source.height;

	const inCanvas = createCanvas(source.width, source.height);
	const inCtx = inCanvas.getContext("2d") as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null;
	if (!inCtx) return source;
	inCtx.putImageData(source, 0, 0);

	const outCanvas = createCanvas(outW, outH);
	const outCtx = outCanvas.getContext("2d") as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null;
	if (!outCtx) return source;

	// Move origin to center of output, apply orientation transform, then draw
	// the source centered at the origin.
	outCtx.translate(outW / 2, outH / 2);
	switch (orientation) {
		case 2:
			outCtx.scale(-1, 1);
			break;
		case 3:
			outCtx.rotate(Math.PI);
			break;
		case 4:
			outCtx.scale(1, -1);
			break;
		case 5:
			outCtx.rotate(Math.PI / 2);
			outCtx.scale(1, -1);
			break;
		case 6:
			outCtx.rotate(Math.PI / 2);
			break;
		case 7:
			outCtx.rotate(-Math.PI / 2);
			outCtx.scale(1, -1);
			break;
		case 8:
			outCtx.rotate(-Math.PI / 2);
			break;
	}
	outCtx.drawImage(
		inCanvas as CanvasImageSource,
		-source.width / 2,
		-source.height / 2,
	);
	return (outCtx as CanvasRenderingContext2D).getImageData(0, 0, outW, outH);
}

function createCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
	if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
	const c = document.createElement("canvas");
	c.width = w;
	c.height = h;
	return c;
}