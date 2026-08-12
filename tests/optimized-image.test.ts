import { describe, expect, it } from "vitest";
import {
	isOptimizedImage,
	toOptimizedImage,
	variantBlobs,
} from "../src/types/optimized-image";
import type { RasterFormat, SquashResult, VariantResult } from "../src/types/squash";

function fakeResult(format: RasterFormat): SquashResult {
	const rasterMime = format === "png" ? "image/png" : "image/jpeg";
	const variant = (w: number, h: number): VariantResult => ({
		raster: { blob: new Blob(), width: w, height: h, mimeType: rasterMime },
		avif: { blob: new Blob(), width: w, height: h, mimeType: "image/avif" },
	});
	return {
		variants: {
			sm: variant(640, 480),
			md: variant(1024, 768),
			lg: variant(1440, 1080),
			org: variant(1920, 1440),
		},
		format,
		alpha: { nonOpaque: 0, total: 1, ratio: 0, isTransparent: false },
		source: { width: 4000, height: 3000, mimeType: "image/jpeg" },
	};
}

describe("toOptimizedImage", () => {
	it("maps result dimensions + resolved URLs into a storable OptimizedImage", () => {
		const img = toOptimizedImage(
			fakeResult("jpeg"),
			(key, kind) => `https://cdn/${key}.${kind}`,
		);

		expect(img.v).toBe(1);
		expect(img.format).toBe("jpeg");
		expect(img.sm).toEqual({
			w: 640,
			h: 480,
			url: "https://cdn/sm.raster",
			avifUrl: "https://cdn/sm.avif",
		});
		expect(img.org).toEqual({
			w: 1920,
			h: 1440,
			url: "https://cdn/org.raster",
			avifUrl: "https://cdn/org.avif",
		});
		// The result is a valid OptimizedImage by the package's own guard.
		expect(isOptimizedImage(img)).toBe(true);
	});

	it("carries the PNG format through", () => {
		const img = toOptimizedImage(fakeResult("png"), () => "u");
		expect(img.format).toBe("png");
	});

	it("asks the resolver for every variant × kind", () => {
		const seen: string[] = [];
		toOptimizedImage(fakeResult("jpeg"), (key, kind) => {
			seen.push(`${key}.${kind}`);
			return "u";
		});
		expect(seen.sort()).toEqual(
			[
				"lg.avif",
				"lg.raster",
				"md.avif",
				"md.raster",
				"org.avif",
				"org.raster",
				"sm.avif",
				"sm.raster",
			].sort(),
		);
	});
});

describe("variantBlobs", () => {
	it("flattens a result into 8 entries (raster + avif per variant) with dims", () => {
		const entries = variantBlobs(fakeResult("jpeg"));

		expect(entries).toHaveLength(8);
		expect(entries.map((e) => `${e.key}.${e.kind}`)).toEqual([
			"sm.raster",
			"sm.avif",
			"md.raster",
			"md.avif",
			"lg.raster",
			"lg.avif",
			"org.raster",
			"org.avif",
		]);
		expect(entries[0]).toMatchObject({ key: "sm", kind: "raster", width: 640, height: 480 });
		expect(entries[0].blob).toBeInstanceOf(Blob);

		const lgAvif = entries.find((e) => e.key === "lg" && e.kind === "avif");
		expect(lgAvif).toMatchObject({ width: 1440, height: 1080 });
	});
});
