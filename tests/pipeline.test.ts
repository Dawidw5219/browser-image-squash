import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeAlpha, calcResizeDimensions, posterizeRgb } from "../src/core/image-ops";
import { getConfig, initializeSquash, resetConfig } from "../src/core/config";
import { squash } from "../src/core/pipeline";
import type { Codecs } from "../src/types/squash";

function makeImageData(
	w: number,
	h: number,
	fill: (i: number) => [number, number, number, number],
): ImageData {
	const data = new Uint8ClampedArray(w * h * 4);
	for (let i = 0; i < w * h; i++) {
		const [r, g, b, a] = fill(i);
		data[i * 4] = r;
		data[i * 4 + 1] = g;
		data[i * 4 + 2] = b;
		data[i * 4 + 3] = a;
	}
	return new ImageData(data, w, h);
}

function makeMockCodecs(source: ImageData): Codecs {
	return {
		jpegDecode: vi.fn(async () => source),
		pngDecode: vi.fn(async () => source),
		pngEncode: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer),
		jpegEncode: vi.fn(
			async (data) => new Uint8Array([0xff, 0xd8, 0xff, data.width, data.height]).buffer,
		),
		oxipngOptimize: vi.fn(async (buf) => buf),
		avifEncode: vi.fn(
			async (data) => new Uint8Array([0x00, 0x00, 0x00, 0x20, data.width]).buffer,
		),
		resize: vi.fn(async (_data, { width, height }) =>
			makeImageData(width, height, () => [128, 128, 128, 255]),
		),
	};
}

describe("analyzeAlpha", () => {
	it("opaque image → isTransparent=false", () => {
		const img = makeImageData(10, 10, () => [255, 0, 0, 255]);
		const a = analyzeAlpha(img);
		expect(a.nonOpaque).toBe(0);
		expect(a.isTransparent).toBe(false);
		expect(a.ratio).toBe(0);
	});

	it("fully transparent → isTransparent=true", () => {
		const img = makeImageData(10, 10, () => [255, 0, 0, 0]);
		const a = analyzeAlpha(img);
		expect(a.nonOpaque).toBe(100);
		expect(a.isTransparent).toBe(true);
	});

	it("under 5% non-opaque (screenshot artifact) → isTransparent=false", () => {
		const img = makeImageData(10, 10, (i) => (i < 4 ? [255, 0, 0, 250] : [255, 0, 0, 255]));
		const a = analyzeAlpha(img);
		expect(a.nonOpaque).toBe(4);
		expect(a.ratio).toBeCloseTo(0.04);
		expect(a.isTransparent).toBe(false);
	});

	it("over 5% non-opaque → isTransparent=true", () => {
		const img = makeImageData(10, 10, (i) => (i < 10 ? [255, 0, 0, 100] : [255, 0, 0, 255]));
		const a = analyzeAlpha(img);
		expect(a.nonOpaque).toBe(10);
		expect(a.isTransparent).toBe(true);
	});
});

describe("calcResizeDimensions", () => {
	it("no resize when within maxEdge", () => {
		expect(calcResizeDimensions(800, 600, 1024)).toEqual({
			width: 800,
			height: 600,
			needsResize: false,
		});
	});
	it("scales by longest edge, landscape", () => {
		expect(calcResizeDimensions(2000, 1000, 1000)).toEqual({
			width: 1000,
			height: 500,
			needsResize: true,
		});
	});
	it("scales by longest edge, portrait", () => {
		expect(calcResizeDimensions(1000, 2000, 1000)).toEqual({
			width: 500,
			height: 1000,
			needsResize: true,
		});
	});
});

describe("posterizeRgb", () => {
	it("returns input unchanged at quality 100", () => {
		const img = makeImageData(2, 2, () => [123, 45, 67, 255]);
		const out = posterizeRgb(img, 100);
		expect(out).toBe(img);
	});

	it("quantizes RGB at low quality", () => {
		const img = makeImageData(1, 1, () => [127, 127, 127, 200]);
		const out = posterizeRgb(img, 10);
		expect(out.data[0]).toBeLessThan(255);
		expect(out.data[3]).toBe(200);
	});
});

describe("squash() with new config-driven API", () => {
	beforeEach(() => {
		resetConfig();
		if (typeof HTMLCanvasElement !== "undefined") {
			HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
				cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
			};
		}
	});

	afterEach(() => {
		resetConfig();
	});

	it("produces 4 variants (sm/md/lg/org) each with raster + avif for opaque source", async () => {
		initializeSquash({ quality: 80 });
		const src = makeImageData(3000, 2000, () => [200, 100, 50, 255]);
		const codecs = makeMockCodecs(src);
		const input = new Blob([new ArrayBuffer(8)], { type: "image/jpeg" });

		const r = await squash(input, { codecs });

		expect(r.format).toBe("jpeg");
		expect(r.alpha.isTransparent).toBe(false);

		expect(r.variants.sm).toBeDefined();
		expect(r.variants.md).toBeDefined();
		expect(r.variants.lg).toBeDefined();
		expect(r.variants.org).toBeDefined();

		expect(r.variants.sm.raster.mimeType).toBe("image/jpeg");
		expect(r.variants.sm.avif.mimeType).toBe("image/avif");

		const cfg = getConfig();
		expect(r.variants.sm.raster.width).toBe(cfg.sizes.sm);
		expect(r.variants.md.raster.width).toBe(cfg.sizes.md);
		expect(r.variants.lg.raster.width).toBe(cfg.sizes.lg);
		// org is capped by default, so a 3000px source is downscaled, not kept full.
		expect(cfg.sizes.org).not.toBeNull();
		expect(r.variants.org.raster.width).toBe(cfg.sizes.org);
		expect(r.variants.org.raster.width).toBeLessThan(3000);
	});

	it("uses PNG raster for transparent source, AVIF still present", async () => {
		initializeSquash();
		const src = makeImageData(800, 600, (i) =>
			i < 30000 ? [255, 0, 0, 0] : [255, 0, 0, 255],
		);
		const codecs = makeMockCodecs(src);
		const input = new Blob([new ArrayBuffer(8)], { type: "image/png" });

		const r = await squash(input, { codecs });

		expect(r.format).toBe("png");
		expect(r.variants.sm.raster.mimeType).toBe("image/png");
		expect(r.variants.md.raster.mimeType).toBe("image/png");
		expect(r.variants.lg.raster.mimeType).toBe("image/png");
		expect(r.variants.org.raster.mimeType).toBe("image/png");
		expect(r.variants.sm.avif).toBeDefined();
		expect(r.variants.org.avif).toBeDefined();
	});

	it("respects custom sizes from initializeSquash", async () => {
		initializeSquash({ sizes: { sm: 320, md: 768, lg: 1440 } });
		const src = makeImageData(2000, 1500, () => [100, 100, 100, 255]);
		const codecs = makeMockCodecs(src);

		const r = await squash(new Blob([new ArrayBuffer(8)], { type: "image/jpeg" }), { codecs });

		expect(r.variants.sm.raster.width).toBe(320);
		expect(r.variants.md.raster.width).toBe(768);
		expect(r.variants.lg.raster.width).toBe(1440);
	});

	it("does not upscale when source is smaller than variant maxEdge", async () => {
		initializeSquash();
		const src = makeImageData(500, 400, () => [200, 100, 50, 255]);
		const codecs = makeMockCodecs(src);

		const r = await squash(new Blob([new ArrayBuffer(8)], { type: "image/jpeg" }), { codecs });

		expect(r.variants.sm.raster.width).toBe(500);
		expect(r.variants.md.raster.width).toBe(500);
		expect(r.variants.lg.raster.width).toBe(500);
		expect(r.variants.org.raster.width).toBe(500);
	});

	it("auto-initializes config when squash called without prior init", async () => {
		const src = makeImageData(3000, 2000, () => [50, 100, 150, 255]);
		const codecs = makeMockCodecs(src);

		const r = await squash(new Blob([new ArrayBuffer(8)], { type: "image/jpeg" }), { codecs });

		const cfg = getConfig();
		expect(r.variants.sm.raster.width).toBe(cfg.sizes.sm);
		expect(r.variants.md.raster.width).toBe(cfg.sizes.md);
		expect(r.variants.lg.raster.width).toBe(cfg.sizes.lg);
	});
});

describe("squash() cancellation", () => {
	beforeEach(() => resetConfig());
	afterEach(() => resetConfig());

	it("rejects with AbortError when the signal is already aborted", async () => {
		const src = makeImageData(800, 600, () => [10, 20, 30, 255]);
		const codecs = makeMockCodecs(src);
		const ac = new AbortController();
		ac.abort();
		const err = await squash(new Blob([new ArrayBuffer(8)], { type: "image/jpeg" }), {
			codecs,
			signal: ac.signal,
		}).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).name).toBe("AbortError");
	});

	it("aborts mid-pipeline at the next stage boundary", async () => {
		const src = makeImageData(800, 600, () => [10, 20, 30, 255]);
		const ac = new AbortController();
		const codecs = makeMockCodecs(src);
		// Abort during decode; the loop's throwIfAborted must then reject.
		codecs.jpegDecode = vi.fn(async () => {
			ac.abort();
			return src;
		});
		const err = await squash(new Blob([new ArrayBuffer(8)], { type: "image/jpeg" }), {
			codecs,
			signal: ac.signal,
		}).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).name).toBe("AbortError");
	});
});

describe("squash() org raster fallback", () => {
	beforeEach(() => resetConfig());
	afterEach(() => resetConfig());

	it("keeps the source bytes for org when the re-encode is larger", async () => {
		initializeSquash();
		const src = makeImageData(3000, 2000, () => [200, 100, 50, 255]);
		const codecs = makeMockCodecs(src);
		// Every raster encode is 100 bytes — larger than the 8-byte source.
		codecs.jpegEncode = vi.fn(async () => new Uint8Array(100).buffer);

		const r = await squash(new Blob([new ArrayBuffer(8)], { type: "image/jpeg" }), { codecs });

		// org falls back to the original source bytes (8); other sizes keep the 100-byte encode.
		expect(r.variants.org.raster.blob.size).toBe(8);
		expect(r.variants.org.raster.mimeType).toBe("image/jpeg");
		expect(r.variants.sm.raster.blob.size).toBe(100);
		expect(r.variants.md.raster.blob.size).toBe(100);
		expect(r.variants.lg.raster.blob.size).toBe(100);
	});
});
