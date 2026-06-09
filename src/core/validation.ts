/**
 * Pre-decode input validation — runs before any expensive WASM work to fail
 * fast on inputs that could DoS the encoder (huge files, image bombs) or that
 * we deliberately don't support (animated GIFs).
 *
 * All checks are cheap: file size is a number, pixel count comes from a
 * 32-byte header peek, GIF animation detection is a single-pass scan over
 * application/graphic-control extension blocks.
 */

export const DEFAULT_MAX_FILE_SIZE_MB = 50;
export const DEFAULT_MAX_PIXELS_MP = 100;

export interface InputLimits {
	/** Reject files larger than this. `false` disables. Default 50 MB. */
	maxFileSizeMB?: number | false;
	/** Reject images with more than this many megapixels (W×H/1e6). `false` disables. Default 100 MP. */
	maxPixelsMP?: number | false;
}

export class InputSizeLimitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InputSizeLimitError";
	}
}

export class InputPixelLimitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InputPixelLimitError";
	}
}

export class UnsupportedAnimatedImageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnsupportedAnimatedImageError";
	}
}

export class UnsupportedMimeTypeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnsupportedMimeTypeError";
	}
}

/**
 * Thrown when a format passes the input gate but the browser cannot actually
 * decode it — most often HEIC/HEIF on Chrome/Firefox (only Safari decodes
 * those via `createImageBitmap`). Turns a cryptic codec failure into an
 * actionable error.
 */
export class ImageDecodeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ImageDecodeError";
	}
}

/* ── File size ──────────────────────────────────────────── */

export function validateFileSize(
	byteLength: number,
	limit: number | false = DEFAULT_MAX_FILE_SIZE_MB,
): void {
	if (limit === false) return;
	const max = limit * 1024 * 1024;
	if (byteLength > max) {
		const got = (byteLength / 1024 / 1024).toFixed(1);
		throw new InputSizeLimitError(
			`Input too large: ${got} MB exceeds ${limit} MB limit. ` +
				`Set { maxFileSizeMB: false } to disable, or raise the limit.`,
		);
	}
}

/* ── Pixel-count (image bomb defense) ───────────────────── */

export interface PeekedDimensions {
	width: number;
	height: number;
}

/**
 * Read width/height from a JPEG, PNG, WebP or GIF header without fully
 * decoding the image. Returns null if the format isn't recognized — caller
 * should let `createImageBitmap()` handle exotic inputs.
 */
export function peekDimensions(
	buffer: ArrayBuffer,
	mimeType: string,
): PeekedDimensions | null {
	const v = new DataView(buffer);
	if (mimeType === "image/png") return peekPng(v);
	if (mimeType === "image/jpeg") return peekJpeg(v);
	if (mimeType === "image/webp") return peekWebp(v);
	if (mimeType === "image/gif") return peekGif(v);
	return null;
}

function peekPng(v: DataView): PeekedDimensions | null {
	// PNG: 8-byte signature, then IHDR chunk with W/H at offsets 16/20
	if (v.byteLength < 24) return null;
	if (v.getUint32(0) !== 0x89504e47) return null;
	return { width: v.getUint32(16), height: v.getUint32(20) };
}

function peekJpeg(v: DataView): PeekedDimensions | null {
	// JPEG: scan markers for SOFn (0xC0..0xCF except DHT/JPG/DAC: C4/C8/CC)
	if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
	let off = 2;
	while (off < v.byteLength - 8) {
		if (v.getUint8(off) !== 0xff) return null;
		const marker = v.getUint8(off + 1);
		if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS
		const segLen = v.getUint16(off + 2);
		const isSOF =
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc;
		if (isSOF) {
			return { height: v.getUint16(off + 5), width: v.getUint16(off + 7) };
		}
		off += 2 + segLen;
	}
	return null;
}

function peekWebp(v: DataView): PeekedDimensions | null {
	// RIFF....WEBP, then VP8/VP8L/VP8X chunk
	if (v.byteLength < 30) return null;
	if (v.getUint32(0) !== 0x52494646 /* RIFF */) return null;
	if (v.getUint32(8) !== 0x57454250 /* WEBP */) return null;
	const chunk = v.getUint32(12);
	if (chunk === 0x56503820 /* "VP8 " (lossy) */) {
		return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
	}
	if (chunk === 0x5650384c /* VP8L (lossless) */) {
		const b0 = v.getUint8(21);
		const b1 = v.getUint8(22);
		const b2 = v.getUint8(23);
		const b3 = v.getUint8(24);
		return {
			width: 1 + (((b1 & 0x3f) << 8) | b0),
			height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
		};
	}
	if (chunk === 0x56503858 /* VP8X (extended) */) {
		return {
			width: 1 + (v.getUint8(24) | (v.getUint8(25) << 8) | (v.getUint8(26) << 16)),
			height: 1 + (v.getUint8(27) | (v.getUint8(28) << 8) | (v.getUint8(29) << 16)),
		};
	}
	return null;
}

function peekGif(v: DataView): PeekedDimensions | null {
	// GIF87a/89a: 6-byte signature, then logical screen W/H little-endian at 6/8
	if (v.byteLength < 10) return null;
	const sig = v.getUint32(0);
	if (sig !== 0x47494638 /* "GIF8" */) return null;
	return { width: v.getUint16(6, true), height: v.getUint16(8, true) };
}

export function validatePixelCount(
	dims: PeekedDimensions | null,
	limit: number | false = DEFAULT_MAX_PIXELS_MP,
): void {
	if (limit === false || !dims) return;
	const mp = (dims.width * dims.height) / 1_000_000;
	if (mp > limit) {
		throw new InputPixelLimitError(
			`Image too large: ${dims.width}×${dims.height} = ${mp.toFixed(1)} MP ` +
				`exceeds ${limit} MP limit. Set { maxPixelsMP: false } to disable.`,
		);
	}
}

/* ── Animated GIF detection ─────────────────────────────── */

/**
 * Detect animated GIF (multiple Image Descriptor blocks OR NETSCAPE2.0 loop
 * extension). Static single-frame GIFs return `false` — those we can decode
 * via `createImageBitmap()` and treat as a normal image.
 */
export function isAnimatedGif(buffer: ArrayBuffer, mimeType: string): boolean {
	if (mimeType !== "image/gif") return false;
	const bytes = new Uint8Array(buffer);
	if (bytes.length < 13 || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) {
		return false;
	}
	// Skip 6-byte sig + 7-byte logical screen descriptor
	let i = 13;
	const packed = bytes[10];
	if (packed & 0x80) {
		// Global color table present — skip it (3 × 2^(GCT size + 1) bytes)
		const gctSize = 3 * (1 << ((packed & 0x07) + 1));
		i += gctSize;
	}
	let imageDescriptors = 0;
	let hasNetscapeLoop = false;
	while (i < bytes.length) {
		const b = bytes[i];
		if (b === 0x3b) break; // Trailer
		if (b === 0x2c) {
			imageDescriptors++;
			if (imageDescriptors >= 2) return true;
			// Skip image descriptor (10 bytes total starting with 0x2C) + optional LCT + image data sub-blocks
			i += 10;
			const lctFlag = bytes[i - 1];
			if (lctFlag & 0x80) {
				const lctSize = 3 * (1 << ((lctFlag & 0x07) + 1));
				i += lctSize;
			}
			i++; // LZW min code size
			i = skipSubBlocks(bytes, i);
			continue;
		}
		if (b === 0x21) {
			// Extension introducer
			const label = bytes[i + 1];
			if (label === 0xff) {
				// Application extension — check for NETSCAPE2.0
				if (
					bytes[i + 2] === 11 &&
					bytes[i + 3] === 0x4e /*N*/ &&
					bytes[i + 4] === 0x45 &&
					bytes[i + 5] === 0x54 &&
					bytes[i + 6] === 0x53 &&
					bytes[i + 7] === 0x43 &&
					bytes[i + 8] === 0x41 &&
					bytes[i + 9] === 0x50 &&
					bytes[i + 10] === 0x45 &&
					bytes[i + 11] === 0x32 /*2*/
				) {
					hasNetscapeLoop = true;
				}
			}
			i += 2; // Skip introducer + label
			i = skipSubBlocks(bytes, i);
			continue;
		}
		i++;
	}
	return hasNetscapeLoop || imageDescriptors >= 2;
}

function skipSubBlocks(bytes: Uint8Array, i: number): number {
	while (i < bytes.length) {
		const len = bytes[i];
		i++;
		if (len === 0) return i;
		i += len;
	}
	return i;
}

/* ── Combined input gate ────────────────────────────────── */

const SUPPORTED_INPUT_MIMES = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
	"image/avif",
	"image/heic",
	"image/heif",
	"image/tiff",
	"image/bmp",
]);

export interface InputGateOptions extends InputLimits {
	/** Override the set of accepted mime types. Default: common raster formats. */
	allowedMimeTypes?: ReadonlySet<string>;
}

/**
 * Run all pre-decode checks in one place. Throws on the first failure with a
 * typed error so callers can branch on `err instanceof UnsupportedAnimatedImageError` etc.
 */
export function validateInput(
	buffer: ArrayBuffer,
	mimeType: string,
	options: InputGateOptions = {},
): void {
	const allowed = options.allowedMimeTypes ?? SUPPORTED_INPUT_MIMES;
	if (mimeType && !allowed.has(mimeType)) {
		throw new UnsupportedMimeTypeError(
			`Unsupported mime type: ${mimeType}. ` +
				`Accepted: ${Array.from(allowed).join(", ")}.`,
		);
	}
	validateFileSize(buffer.byteLength, options.maxFileSizeMB);
	if (mimeType === "image/gif" && isAnimatedGif(buffer, mimeType)) {
		throw new UnsupportedAnimatedImageError(
			"Animated GIFs are not supported. " +
				"Convert to a single-frame format (PNG/JPEG) before squashing.",
		);
	}
	const dims = peekDimensions(buffer, mimeType);
	validatePixelCount(dims, options.maxPixelsMP);
}
