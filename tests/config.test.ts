import { afterEach, describe, expect, it } from "vitest";
import {
	AVIF_FLOOR,
	AVIF_OFFSET,
	AVIF_SPEED_DEFAULT,
	AVIF_SPEED_MAX,
	AVIF_SPEED_MIN,
	DEFAULT_ORG_SIZE,
	DEFAULT_SIZES,
	QUALITY_DEFAULT,
	QUALITY_MAX,
	QUALITY_MIN,
	SIZE_MAX_PX,
	SIZE_MIN_GAP_PX,
	SIZE_MIN_PX,
	computeAvifQuality,
	getConfig,
	initializeSquash,
	isInitialized,
	resetConfig,
} from "../src/core/config";

afterEach(() => {
	resetConfig();
});

describe("initializeSquash", () => {
	it("uses defaults when called with no options", () => {
		const cfg = initializeSquash();
		expect(cfg.quality).toBe(QUALITY_DEFAULT);
		expect(cfg.sizes).toEqual({ ...DEFAULT_SIZES, org: DEFAULT_ORG_SIZE });
		expect(cfg.avifQuality).toBe(QUALITY_DEFAULT - AVIF_OFFSET);
	});

	it("applies custom quality and derives AVIF quality", () => {
		const cfg = initializeSquash({ quality: 90 });
		expect(cfg.quality).toBe(90);
		expect(cfg.avifQuality).toBe(65);
	});

	it("clamps AVIF quality to floor when user quality is low", () => {
		const cfg = initializeSquash({ quality: 50 });
		expect(cfg.quality).toBe(50);
		expect(cfg.avifQuality).toBe(AVIF_FLOOR);
	});

	it("merges partial sizes override with defaults", () => {
		const cfg = initializeSquash({ sizes: { md: 1024 } });
		expect(cfg.sizes).toEqual({ sm: 640, md: 1024, lg: 1440, org: DEFAULT_ORG_SIZE });
	});

	it("caps org by default and disables the cap with org: false", () => {
		expect(initializeSquash().sizes.org).toBe(DEFAULT_ORG_SIZE);
		expect(initializeSquash({ sizes: { org: false } }).sizes.org).toBeNull();
		expect(initializeSquash({ sizes: { org: 2560 } }).sizes.org).toBe(2560);
	});

	it("defaults avifSpeed to the balanced default", () => {
		expect(initializeSquash().avifSpeed).toBe(AVIF_SPEED_DEFAULT);
	});

	it("applies a custom avifSpeed", () => {
		expect(initializeSquash({ avifSpeed: 10 }).avifSpeed).toBe(10);
	});

	it("accepts the avifSpeed range bounds", () => {
		expect(initializeSquash({ avifSpeed: AVIF_SPEED_MIN }).avifSpeed).toBe(AVIF_SPEED_MIN);
		expect(initializeSquash({ avifSpeed: AVIF_SPEED_MAX }).avifSpeed).toBe(AVIF_SPEED_MAX);
	});

	it("rejects out-of-range or non-integer avifSpeed", () => {
		expect(() => initializeSquash({ avifSpeed: AVIF_SPEED_MAX + 1 })).toThrow(RangeError);
		expect(() => initializeSquash({ avifSpeed: -1 })).toThrow(RangeError);
		expect(() => initializeSquash({ avifSpeed: 4.5 })).toThrow(RangeError);
	});

	it("rejects quality below minimum", () => {
		expect(() => initializeSquash({ quality: QUALITY_MIN - 1 })).toThrow(RangeError);
	});

	it("rejects quality above maximum", () => {
		expect(() => initializeSquash({ quality: QUALITY_MAX + 1 })).toThrow(RangeError);
	});

	it("rejects non-finite quality", () => {
		expect(() => initializeSquash({ quality: Number.NaN })).toThrow(RangeError);
	});

	it("rejects non-integer size", () => {
		expect(() => initializeSquash({ sizes: { sm: 640.5 } })).toThrow(RangeError);
	});

	it("rejects non-positive size", () => {
		expect(() => initializeSquash({ sizes: { sm: 0 } })).toThrow(RangeError);
	});

	it("rejects out-of-order sizes", () => {
		expect(() => initializeSquash({ sizes: { sm: 2000 } })).toThrow(/strictly increasing/);
		expect(() => initializeSquash({ sizes: { lg: 800 } })).toThrow(/strictly increasing/);
	});

	it("rejects size below minimum bound", () => {
		expect(() => initializeSquash({ sizes: { sm: SIZE_MIN_PX - 1 } })).toThrow(
			new RegExp(`sizes.sm must be in \\[${SIZE_MIN_PX}, ${SIZE_MAX_PX}\\]`),
		);
	});

	it("rejects size above maximum bound", () => {
		expect(() => initializeSquash({ sizes: { lg: SIZE_MAX_PX + 1 } })).toThrow(
			new RegExp(`sizes.lg must be in \\[${SIZE_MIN_PX}, ${SIZE_MAX_PX}\\]`),
		);
	});

	it("rejects duplicate sizes", () => {
		expect(() => initializeSquash({ sizes: { sm: 1280, md: 1280 } })).toThrow(
			/sizes must be unique/,
		);
		expect(() => initializeSquash({ sizes: { md: 1920, lg: 1920 } })).toThrow(
			/sizes must be unique/,
		);
	});

	it("rejects too-close sizes (min gap)", () => {
		expect(() =>
			initializeSquash({ sizes: { sm: 640, md: 640 + SIZE_MIN_GAP_PX - 1 } }),
		).toThrow(/gap between sm and md/);
		expect(() =>
			initializeSquash({ sizes: { md: 1280, lg: 1280 + SIZE_MIN_GAP_PX - 1 } }),
		).toThrow(/gap between md and lg/);
	});

	it("rejects Infinity size", () => {
		expect(() => initializeSquash({ sizes: { sm: Number.POSITIVE_INFINITY } })).toThrow(
			RangeError,
		);
	});

	it("re-calling replaces previous config", () => {
		initializeSquash({ quality: 90 });
		const cfg = initializeSquash({ quality: 60 });
		expect(cfg.quality).toBe(60);
		expect(getConfig().quality).toBe(60);
	});
});

describe("getConfig", () => {
	it("auto-initializes with defaults when never called", () => {
		expect(isInitialized()).toBe(false);
		const cfg = getConfig();
		expect(isInitialized()).toBe(true);
		expect(cfg.quality).toBe(QUALITY_DEFAULT);
	});

	it("returns initialized config", () => {
		initializeSquash({ quality: 70 });
		expect(getConfig().quality).toBe(70);
	});
});

describe("resetConfig", () => {
	it("clears the singleton", () => {
		initializeSquash({ quality: 50 });
		expect(isInitialized()).toBe(true);
		resetConfig();
		expect(isInitialized()).toBe(false);
	});
});

describe("computeAvifQuality", () => {
	it("subtracts offset for high quality", () => {
		expect(computeAvifQuality(95)).toBe(70);
		expect(computeAvifQuality(80)).toBe(55);
		expect(computeAvifQuality(65)).toBe(AVIF_FLOOR);
	});

	it("never drops below floor", () => {
		expect(computeAvifQuality(40)).toBe(AVIF_FLOOR);
		expect(computeAvifQuality(50)).toBe(AVIF_FLOOR);
	});
});
