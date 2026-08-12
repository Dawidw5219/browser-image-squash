import { describe, expect, it } from "vitest";
import { estimateJpegQuality } from "../src/core/jpeg-quality";

/** Build a minimal JPEG carrying a single 8-bit luminance quant table. */
function jpegWithLumaTable(fill: number): Uint8Array {
	const table = new Array(64).fill(fill);
	return new Uint8Array([
		0xff, 0xd8, // SOI
		0xff, 0xdb, // DQT
		0x00, 0x43, // segment length = 2 + 1 + 64 = 67
		0x00, // spec: precision 0, table id 0
		...table,
		0xff, 0xd9, // EOI
	]);
}

describe("estimateJpegQuality", () => {
	it("returns null for a non-JPEG buffer", () => {
		// PNG magic bytes
		expect(estimateJpegQuality(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
	});

	it("returns null for a too-short buffer", () => {
		expect(estimateJpegQuality(new Uint8Array([]))).toBeNull();
		expect(estimateJpegQuality(new Uint8Array([0xff]))).toBeNull();
	});

	it("returns null for a valid JPEG with no quant tables", () => {
		// SOI + EOI only — structurally a JPEG, but no DQT to estimate from.
		expect(estimateJpegQuality(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
	});

	it("estimates a number in [1,100] from a real quant table", () => {
		const q = estimateJpegQuality(jpegWithLumaTable(1));
		expect(typeof q).toBe("number");
		expect(q).toBeGreaterThanOrEqual(1);
		expect(q).toBeLessThanOrEqual(100);
	});

	it("maps smaller quant values to higher quality (monotonic)", () => {
		const highQ = estimateJpegQuality(jpegWithLumaTable(1)); // near-lossless
		const lowQ = estimateJpegQuality(jpegWithLumaTable(50)); // coarse
		expect(highQ).not.toBeNull();
		expect(lowQ).not.toBeNull();
		expect(highQ as number).toBeGreaterThanOrEqual(90);
		expect(highQ as number).toBeGreaterThan(lowQ as number);
	});

	it("accepts an ArrayBuffer as well as a Uint8Array", () => {
		const bytes = jpegWithLumaTable(1);
		const fromView = estimateJpegQuality(bytes);
		const fromBuffer = estimateJpegQuality(
			bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
		);
		expect(fromBuffer).toBe(fromView);
	});
});
