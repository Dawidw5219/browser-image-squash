import { describe, expect, it } from "vitest";
import {
	InputPixelLimitError,
	InputSizeLimitError,
	UnsupportedAnimatedImageError,
	UnsupportedMimeTypeError,
	isAnimatedGif,
	peekDimensions,
	validateFileSize,
	validateInput,
	validatePixelCount,
} from "../src/core/validation";
import { readJpegOrientation } from "../src/core/image-ops";

/* ── File size limit ─────────────────────────────────────── */

describe("validateFileSize", () => {
	it("passes when under limit", () => {
		expect(() => validateFileSize(10 * 1024 * 1024, 50)).not.toThrow();
	});

	it("throws when over limit", () => {
		expect(() => validateFileSize(60 * 1024 * 1024, 50)).toThrow(
			InputSizeLimitError,
		);
	});

	it("is disabled by `false`", () => {
		expect(() => validateFileSize(10_000 * 1024 * 1024, false)).not.toThrow();
	});

	it("uses default 50 MB when no limit provided", () => {
		expect(() => validateFileSize(60 * 1024 * 1024)).toThrow();
		expect(() => validateFileSize(40 * 1024 * 1024)).not.toThrow();
	});
});

/* ── Dimension peek (no decode) ──────────────────────────── */

function makePngHeader(w: number, h: number): ArrayBuffer {
	const buf = new ArrayBuffer(24);
	const v = new DataView(buf);
	v.setUint32(0, 0x89504e47); // signature
	v.setUint32(16, w);
	v.setUint32(20, h);
	return buf;
}

function makeJpegHeaderWithSOF(w: number, h: number): ArrayBuffer {
	// SOI + APP0 (16 bytes JFIF) + SOF0 (8 bytes), enough for peek
	const buf = new ArrayBuffer(32);
	const v = new DataView(buf);
	v.setUint16(0, 0xffd8); // SOI
	v.setUint16(2, 0xffe0); // APP0
	v.setUint16(4, 16); // segment length
	v.setUint8(20, 0xff); // start of SOF
	v.setUint8(21, 0xc0); // SOF0
	v.setUint16(22, 8); // segment length
	v.setUint8(24, 8); // precision
	v.setUint16(25, h);
	v.setUint16(27, w);
	return buf;
}

describe("peekDimensions", () => {
	it("reads PNG dimensions from header", () => {
		expect(peekDimensions(makePngHeader(1920, 1080), "image/png")).toEqual({
			width: 1920,
			height: 1080,
		});
	});

	it("reads JPEG dimensions from SOF marker", () => {
		expect(peekDimensions(makeJpegHeaderWithSOF(640, 480), "image/jpeg")).toEqual({
			width: 640,
			height: 480,
		});
	});

	it("returns null for unsupported mime", () => {
		expect(peekDimensions(new ArrayBuffer(100), "image/avif")).toBeNull();
	});

	it("returns null for malformed input", () => {
		expect(peekDimensions(new ArrayBuffer(4), "image/png")).toBeNull();
	});
});

/* ── Pixel limit ─────────────────────────────────────────── */

describe("validatePixelCount", () => {
	it("passes under limit", () => {
		expect(() => validatePixelCount({ width: 8000, height: 6000 }, 100)).not.toThrow();
	});

	it("throws over limit", () => {
		expect(() => validatePixelCount({ width: 12000, height: 9000 }, 100)).toThrow(
			InputPixelLimitError,
		);
	});

	it("is a no-op when dims unknown", () => {
		expect(() => validatePixelCount(null, 100)).not.toThrow();
	});

	it("is disabled by `false`", () => {
		expect(() => validatePixelCount({ width: 50000, height: 50000 }, false)).not.toThrow();
	});
});

/* ── Animated GIF detection ──────────────────────────────── */

function makeStaticGif(): ArrayBuffer {
	// Minimal GIF89a: signature + logical screen descriptor + single image
	// descriptor + trailer. No NETSCAPE extension, only 1 image descriptor.
	const bytes = new Uint8Array([
		0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
		0x01, 0x00, 0x01, 0x00,             // 1x1 logical screen
		0x00, 0x00, 0x00,                   // packed (no GCT), bg, aspect
		0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // image descriptor
		0x02,                               // LZW min code
		0x02, 0x44, 0x01,                   // sub-block
		0x00,                               // block terminator
		0x3b,                               // trailer
	]);
	return bytes.buffer;
}

function makeAnimatedGif(): ArrayBuffer {
	// Two image descriptors back-to-back — animated.
	const bytes = new Uint8Array([
		0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
		0x01, 0x00, 0x01, 0x00,
		0x00, 0x00, 0x00,
		// frame 1
		0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
		0x02, 0x02, 0x44, 0x01, 0x00,
		// frame 2
		0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
		0x02, 0x02, 0x44, 0x01, 0x00,
		0x3b,
	]);
	return bytes.buffer;
}

describe("isAnimatedGif", () => {
	it("returns false for static GIF", () => {
		expect(isAnimatedGif(makeStaticGif(), "image/gif")).toBe(false);
	});

	it("returns true for multi-frame GIF", () => {
		expect(isAnimatedGif(makeAnimatedGif(), "image/gif")).toBe(true);
	});

	it("returns false for non-GIF inputs", () => {
		expect(isAnimatedGif(makePngHeader(10, 10), "image/png")).toBe(false);
	});
});

/* ── Combined input gate ─────────────────────────────────── */

describe("validateInput", () => {
	it("rejects unsupported mime", () => {
		expect(() => validateInput(new ArrayBuffer(100), "image/svg+xml")).toThrow(
			UnsupportedMimeTypeError,
		);
	});

	it("rejects animated GIF", () => {
		expect(() => validateInput(makeAnimatedGif(), "image/gif")).toThrow(
			UnsupportedAnimatedImageError,
		);
	});

	it("rejects oversized files", () => {
		const big = new ArrayBuffer(60 * 1024 * 1024);
		new DataView(big).setUint32(0, 0x89504e47); // PNG sig so mime check passes
		expect(() => validateInput(big, "image/png", { maxFileSizeMB: 50 })).toThrow(
			InputSizeLimitError,
		);
	});

	it("rejects image bombs", () => {
		const huge = makePngHeader(20000, 20000);
		expect(() => validateInput(huge, "image/png", { maxPixelsMP: 100 })).toThrow(
			InputPixelLimitError,
		);
	});

	it("accepts a sane PNG", () => {
		expect(() => validateInput(makePngHeader(1920, 1080), "image/png")).not.toThrow();
	});

	it("respects per-call disable flags", () => {
		const big = new ArrayBuffer(200 * 1024 * 1024);
		new DataView(big).setUint32(0, 0x89504e47);
		expect(() =>
			validateInput(big, "image/png", { maxFileSizeMB: false }),
		).not.toThrow();
	});
});

/* ── EXIF orientation ────────────────────────────────────── */

function makeJpegWithExifOrientation(orientation: number): ArrayBuffer {
	// SOI + APP1(Exif…) with a single IFD entry: tag=0x0112, type=SHORT, count=1, value=<orientation>
	const exif = new Uint8Array([
		0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
		0x49, 0x49, 0x2a, 0x00,             // little-endian TIFF
		0x08, 0x00, 0x00, 0x00,             // IFD offset = 8
		0x01, 0x00,                         // entry count = 1
		0x12, 0x01,                         // tag 0x0112 (Orientation)
		0x03, 0x00,                         // type SHORT
		0x01, 0x00, 0x00, 0x00,             // count = 1
		orientation, 0x00, 0x00, 0x00,      // value (SHORT, low byte)
		0x00, 0x00, 0x00, 0x00,             // next IFD offset = 0
	]);
	const segLen = exif.length + 2;
	const total = 2 /*SOI*/ + 4 /*marker+len*/ + exif.length + 2 /*EOI*/;
	const out = new Uint8Array(total);
	const v = new DataView(out.buffer);
	v.setUint16(0, 0xffd8); // SOI
	v.setUint16(2, 0xffe1); // APP1
	v.setUint16(4, segLen); // segment length (incl. length bytes)
	out.set(exif, 6);
	v.setUint16(6 + exif.length, 0xffd9); // EOI
	return out.buffer;
}

describe("readJpegOrientation", () => {
	it("returns 1 when no EXIF segment", () => {
		const v = new ArrayBuffer(4);
		new DataView(v).setUint16(0, 0xffd8);
		new DataView(v).setUint16(2, 0xffd9);
		expect(readJpegOrientation(v)).toBe(1);
	});

	it("returns 1 for non-JPEG input", () => {
		expect(readJpegOrientation(makePngHeader(10, 10))).toBe(1);
	});

	for (const o of [1, 3, 6, 8] as const) {
		it(`reads orientation ${o}`, () => {
			expect(readJpegOrientation(makeJpegWithExifOrientation(o))).toBe(o);
		});
	}
});
