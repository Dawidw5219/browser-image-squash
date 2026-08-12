import { describe, expect, it, vi } from "vitest";
import {
	OXIPNG_LEVEL,
	encodePngBuffer,
	resizeToMaxEdge,
} from "../src/core/raster-ops";

// These cover the only multi-step codec logic shared by the main-thread
// pipeline and the worker. Both paths delegate here, so testing it once is the
// parity guard: the two paths cannot diverge on PNG encoding or resize.

function makeImageData(w: number, h: number): ImageData {
	return new ImageData(new Uint8ClampedArray(w * h * 4).fill(128), w, h);
}

describe("encodePngBuffer", () => {
	it("posterizes, PNG-encodes, then OxiPNG-optimizes at the shared level", async () => {
		const src = makeImageData(20, 10);
		const pngBuf = new Uint8Array([1, 2, 3]).buffer;
		const optBuf = new Uint8Array([9]).buffer;
		const pngEncode = vi.fn(async () => pngBuf);
		const oxipng = vi.fn(async () => optBuf);

		const out = await encodePngBuffer(pngEncode, oxipng, src, 70);

		// posterize keeps dimensions; the (posterized) bitmap reaches pngEncode.
		expect(pngEncode).toHaveBeenCalledTimes(1);
		const passed = pngEncode.mock.calls[0][0] as ImageData;
		expect(passed.width).toBe(20);
		expect(passed.height).toBe(10);
		// oxipng receives the PNG bytes at the canonical level; its output wins.
		expect(oxipng).toHaveBeenCalledWith(pngBuf, { level: OXIPNG_LEVEL });
		expect(out).toBe(optBuf);
	});
});

describe("resizeToMaxEdge", () => {
	it("keeps full size and never loads the resize codec when maxEdge is null", async () => {
		const src = makeImageData(100, 60);
		const getResize = vi.fn();

		const r = await resizeToMaxEdge(getResize, src, null);

		expect(r).toEqual({ data: src, resized: false });
		expect(getResize).not.toHaveBeenCalled();
	});

	it("skips resize (and the codec load) when the source already fits", async () => {
		const src = makeImageData(100, 60);
		const getResize = vi.fn();

		const r = await resizeToMaxEdge(getResize, src, 200); // longest edge 100 ≤ 200

		expect(r.resized).toBe(false);
		expect(r.data).toBe(src);
		expect(getResize).not.toHaveBeenCalled();
	});

	it("downscales by the longest edge and returns the resized bitmap", async () => {
		const src = makeImageData(200, 100);
		const out = makeImageData(100, 50);
		const resize = vi.fn(async () => out);
		const getResize = vi.fn(async () => resize);

		const r = await resizeToMaxEdge(getResize, src, 100);

		expect(getResize).toHaveBeenCalledTimes(1);
		expect(resize).toHaveBeenCalledWith(src, { width: 100, height: 50 });
		expect(r).toEqual({ data: out, resized: true });
	});
});
