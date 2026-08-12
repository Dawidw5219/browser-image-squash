import type { InputGateOptions } from "./validation";

export const QUALITY_MIN = 40;
export const QUALITY_MAX = 95;
export const QUALITY_DEFAULT = 80;

export const AVIF_OFFSET = 25;
export const AVIF_FLOOR = 40;

export const ORG_RASTER_QUALITY = 95;
export const ORG_AVIF_QUALITY = 70;

// libavif "speed": 0 = slowest/best compression, 10 = fastest/least efficient.
// Default 6 matches jSquash's own encoder default — a balanced point between
// file size and encode time. Override via `initializeSquash({ avifSpeed })`:
// lower for smaller files (slower), higher for a snappier UI (larger files).
export const AVIF_SPEED_MIN = 0;
export const AVIF_SPEED_MAX = 10;
export const AVIF_SPEED_DEFAULT = 6;

export const SIZE_KEYS = ["sm", "md", "lg"] as const;
export type SquashSizeKey = (typeof SIZE_KEYS)[number];
export type SquashVariantKey = SquashSizeKey | "org";

export const SIZE_MIN_PX = 80;
export const SIZE_MAX_PX = 8000;
export const SIZE_MIN_GAP_PX = 40;

// Even responsive ladder. `org` is capped by default (not full-resolution) so
// the heaviest AVIF encode stays bounded — the single biggest win for speed
// without needing cross-origin isolation / WASM threads. Override any of these
// via `initializeSquash({ sizes })`; pass `sizes.org` up to SIZE_MAX_PX for
// effectively full-resolution originals.
export const DEFAULT_SIZES: Readonly<Record<SquashSizeKey, number>> = {
	sm: 640,
	md: 1024,
	lg: 1440,
};
export const DEFAULT_ORG_SIZE = 1920;

export interface SquashConfig {
	quality?: number;
	/**
	 * Optional per-variant max edge (longer side). `sm`/`md`/`lg` fall back to
	 * `DEFAULT_SIZES` when omitted. `org` is the largest variant and is
	 * **capped at `DEFAULT_ORG_SIZE` (1920px) by default** so the heaviest AVIF
	 * encode stays bounded. Override with `sizes.org: <number>` for a different
	 * cap, or `sizes.org: false` to disable the cap entirely and keep the full
	 * source resolution (no resize).
	 */
	sizes?: Partial<Record<SquashSizeKey, number>> & { org?: number | false };
	/**
	 * AVIF encoder speed (libavif scale): integer in [0, 10]. Lower = slower
	 * encode but smaller files; higher = faster encode, slightly larger files.
	 * Default 6 (libavif's own default). Visual quality is governed by
	 * `quality`, not this — speed only trades encode time for compression
	 * efficiency.
	 */
	avifSpeed?: number;
	/**
	 * Global pre-decode input guards. Applied to every `squash()` call unless
	 * the call passes `limits` itself (which overrides). All fields optional —
	 * omit to use the built-in defaults (50 MB / 100 MP / animated GIF reject).
	 */
	limits?: InputGateOptions;
	/**
	 * Remove ALL EXIF / IPTC / XMP / GPS / camera / author / thumbnail metadata
	 * from output. Default `true`. Kept as a config field for visibility — in
	 * practice this is currently hardcoded `true` (the jSquash JPEG/AVIF
	 * encoders don't embed metadata at all). Privacy guarantee: GPS
	 * coordinates from phone photos NEVER make it to your CDN.
	 */
	removeMetadata?: boolean;
}

export interface ResolvedSquashConfig {
	quality: number;
	avifQuality: number;
	avifSpeed: number;
	sizes: Record<SquashSizeKey, number> & { org: number | null };
	limits?: InputGateOptions;
	removeMetadata: boolean;
}

export function computeAvifQuality(quality: number): number {
	return Math.max(AVIF_FLOOR, quality - AVIF_OFFSET);
}

function validateQuality(q: number): number {
	if (!Number.isFinite(q) || q < QUALITY_MIN || q > QUALITY_MAX) {
		throw new RangeError(
			`browser-image-squash: quality must be a number in [${QUALITY_MIN}, ${QUALITY_MAX}], got ${q}`,
		);
	}
	return q;
}

function validateAvifSpeed(s: number): number {
	if (!Number.isInteger(s) || s < AVIF_SPEED_MIN || s > AVIF_SPEED_MAX) {
		throw new RangeError(
			`browser-image-squash: avifSpeed must be an integer in [${AVIF_SPEED_MIN}, ${AVIF_SPEED_MAX}], got ${s}`,
		);
	}
	return s;
}

function validateSize(name: SquashSizeKey | "org", n: number): number {
	if (!Number.isFinite(n) || !Number.isInteger(n)) {
		throw new RangeError(
			`browser-image-squash: sizes.${name} must be an integer, got ${n}`,
		);
	}
	if (n < SIZE_MIN_PX || n > SIZE_MAX_PX) {
		throw new RangeError(
			`browser-image-squash: sizes.${name} must be in [${SIZE_MIN_PX}, ${SIZE_MAX_PX}], got ${n}`,
		);
	}
	return n;
}

function validateSizeOrder(sizes: Record<SquashSizeKey, number>): void {
	if (sizes.sm === sizes.md || sizes.md === sizes.lg || sizes.sm === sizes.lg) {
		throw new RangeError(
			`browser-image-squash: sizes must be unique (no duplicates), got sm=${sizes.sm}, md=${sizes.md}, lg=${sizes.lg}`,
		);
	}
	if (!(sizes.sm < sizes.md && sizes.md < sizes.lg)) {
		throw new RangeError(
			`browser-image-squash: sizes must be strictly increasing (sm < md < lg), got sm=${sizes.sm}, md=${sizes.md}, lg=${sizes.lg}`,
		);
	}
	if (sizes.md - sizes.sm < SIZE_MIN_GAP_PX) {
		throw new RangeError(
			`browser-image-squash: gap between sm and md must be ≥ ${SIZE_MIN_GAP_PX}px, got ${sizes.md - sizes.sm}px (sm=${sizes.sm}, md=${sizes.md})`,
		);
	}
	if (sizes.lg - sizes.md < SIZE_MIN_GAP_PX) {
		throw new RangeError(
			`browser-image-squash: gap between md and lg must be ≥ ${SIZE_MIN_GAP_PX}px, got ${sizes.lg - sizes.md}px (md=${sizes.md}, lg=${sizes.lg})`,
		);
	}
}

let _config: ResolvedSquashConfig | null = null;

export function initializeSquash(opts: SquashConfig = {}): ResolvedSquashConfig {
	const quality =
		opts.quality !== undefined ? validateQuality(opts.quality) : QUALITY_DEFAULT;

	const sizes: Record<SquashSizeKey, number> = {
		sm:
			opts.sizes?.sm !== undefined
				? validateSize("sm", opts.sizes.sm)
				: DEFAULT_SIZES.sm,
		md:
			opts.sizes?.md !== undefined
				? validateSize("md", opts.sizes.md)
				: DEFAULT_SIZES.md,
		lg:
			opts.sizes?.lg !== undefined
				? validateSize("lg", opts.sizes.lg)
				: DEFAULT_SIZES.lg,
	};
	validateSizeOrder(sizes);

	const org =
		opts.sizes?.org === false
			? null // explicit opt-out of the cap → keep full source resolution
			: opts.sizes?.org !== undefined
				? validateSize("org", opts.sizes.org)
				: DEFAULT_ORG_SIZE;
	if (org !== null && org <= sizes.lg) {
		throw new RangeError(
			`browser-image-squash: sizes.org must be greater than sizes.lg (${sizes.lg}), got ${org}`,
		);
	}

	_config = {
		quality,
		avifQuality: computeAvifQuality(quality),
		avifSpeed:
			opts.avifSpeed !== undefined
				? validateAvifSpeed(opts.avifSpeed)
				: AVIF_SPEED_DEFAULT,
		sizes: { ...sizes, org },
		limits: opts.limits,
		removeMetadata: opts.removeMetadata ?? true,
	};
	return _config;
}

export function getConfig(): ResolvedSquashConfig {
	if (!_config) return initializeSquash();
	return _config;
}

export function isInitialized(): boolean {
	return _config !== null;
}

export function resetConfig(): void {
	_config = null;
}
