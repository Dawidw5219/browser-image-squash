import type { SquashVariantKey } from "../core/config";
import type { SquashResult } from "./squash";

/**
 * Persistent JSON shape stored in your database after squash+upload.
 *
 *   Use this as the canonical column type for "image uploaded via
 *   browser-image-squash + your CDN of choice". It carries enough metadata
 *   for `<picture>` rendering (per-variant dimensions for CLS) and is
 *   forward-compatible via the `v` schema-version field.
 *
 * Example value:
 *   {
 *     v: 1,
 *     format: "jpeg",
 *     sm:  { w: 480,  h: 320,  url: ".../sm.jpg",  avifUrl: ".../sm.avif"  },
 *     md:  { w: 1024, h: 683,  url: ".../md.jpg",  avifUrl: ".../md.avif"  },
 *     lg:  { w: 1440, h: 960,  url: ".../lg.jpg",  avifUrl: ".../lg.avif"  },
 *     org: { w: 1920, h: 1280, url: ".../org.jpg", avifUrl: ".../org.avif" },
 *   }
 *
 * `org` IS the original (full-resolution raster + avif). If no crop was applied,
 * its dimensions == source dimensions. If crop was applied, the pre-crop source
 * is gone — we deliberately don't store separate "source" dimensions.
 */
export interface OptimizedImage {
	/** Schema version — bump if you ever change the shape (lazy migration). */
	v: 1;
	/** Raster format picked once on the source. Both formats stay consistent across variants. */
	format: "jpeg" | "png";
	sm: OptimizedVariant;
	md: OptimizedVariant;
	lg: OptimizedVariant;
	org: OptimizedVariant;
}

export interface OptimizedVariant {
	w: number;
	h: number;
	/** JPEG or PNG URL — universal fallback (set in `<img src>`). */
	url: string;
	/** AVIF URL — modern format, served via `<source type="image/avif">`. Optional because encoder may fail on edge inputs. */
	avifUrl?: string;
}

export const OPTIMIZED_IMAGE_VERSION = 1 as const;

/**
 * Runtime type guard. Useful for tolerant-read code paths that may receive
 * either a legacy plain URL string or a new `OptimizedImage` object.
 */
export function isOptimizedImage(value: unknown): value is OptimizedImage {
	if (!value || typeof value !== "object") return false;
	const o = value as Record<string, unknown>;
	if (o.v !== 1) return false;
	if (o.format !== "jpeg" && o.format !== "png") return false;
	return (
		isVariant(o.sm) && isVariant(o.md) && isVariant(o.lg) && isVariant(o.org)
	);
}

function isVariant(value: unknown): value is OptimizedVariant {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.w === "number" &&
		typeof v.h === "number" &&
		typeof v.url === "string"
	);
}

/**
 * Assemble the storable `OptimizedImage` from a `squash()` result and the URLs
 * your storage returned for each uploaded blob. `url(variant, kind)` maps a
 * variant + format to its stored URL — keep it symmetric with how you keyed the
 * upload (e.g. `${variant}.${kind}`). Per-variant dimensions come from `result`,
 * so the server never has to decode anything to produce a CLS-safe record.
 */
export function toOptimizedImage(
	result: SquashResult,
	url: (variant: SquashVariantKey, kind: "raster" | "avif") => string,
): OptimizedImage {
	const variant = (key: SquashVariantKey): OptimizedVariant => ({
		w: result.variants[key].raster.width,
		h: result.variants[key].raster.height,
		url: url(key, "raster"),
		avifUrl: url(key, "avif"),
	});
	return {
		v: OPTIMIZED_IMAGE_VERSION,
		format: result.format,
		sm: variant("sm"),
		md: variant("md"),
		lg: variant("lg"),
		org: variant("org"),
	};
}

/**
 * A single uploadable blob from a `squash()` result: the variant, the format
 * kind, the `Blob`, and its dimensions.
 */
export interface VariantBlobEntry {
	key: SquashVariantKey;
	kind: "raster" | "avif";
	blob: Blob;
	width: number;
	height: number;
}

/**
 * Flatten a `squash()` result into its eight uploadable blobs (raster + AVIF per
 * variant) so you can loop once and upload — no hardcoded variant list in your
 * code. Pair it with `toOptimizedImage` once the URLs come back.
 */
export function variantBlobs(result: SquashResult): VariantBlobEntry[] {
	return (["sm", "md", "lg", "org"] as const).flatMap((key): VariantBlobEntry[] => {
		const v = result.variants[key];
		return [
			{ key, kind: "raster", blob: v.raster.blob, width: v.raster.width, height: v.raster.height },
			{ key, kind: "avif", blob: v.avif.blob, width: v.avif.width, height: v.avif.height },
		];
	});
}
