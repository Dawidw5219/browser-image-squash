import type { SquashVariantKey } from "../core/config";
import type { InputGateOptions } from "../core/validation";
import type { SquashWorkerPool } from "../core/worker-pool";

export interface Codecs {
	jpegEncode: (data: ImageData, opts?: { quality?: number }) => Promise<ArrayBuffer>;
	jpegDecode: (data: ArrayBuffer) => Promise<ImageData>;
	pngDecode: (data: ArrayBuffer) => Promise<ImageData>;
	pngEncode: (data: ImageData) => Promise<ArrayBuffer>;
	oxipngOptimize: (data: ArrayBuffer, opts?: { level?: number }) => Promise<ArrayBuffer>;
	avifEncode: (data: ImageData, opts?: { quality?: number; speed?: number }) => Promise<ArrayBuffer>;
	resize: (data: ImageData, opts: { width: number; height: number }) => Promise<ImageData>;
}

export type LogFn = (msg: string) => void;

export type RasterFormat = "png" | "jpeg";
export type RasterMime = "image/png" | "image/jpeg";

export interface AlphaAnalysis {
	nonOpaque: number;
	total: number;
	ratio: number;
	isTransparent: boolean;
}

export interface VariantBlob {
	blob: Blob;
	width: number;
	height: number;
}

export interface RasterBlob extends VariantBlob {
	mimeType: RasterMime;
}

export interface AvifBlob extends VariantBlob {
	mimeType: "image/avif";
}

export interface VariantResult {
	raster: RasterBlob;
	avif: AvifBlob;
}

export interface SquashResult {
	variants: Record<SquashVariantKey, VariantResult>;
	format: RasterFormat;
	alpha: AlphaAnalysis;
	source: { width: number; height: number; mimeType: string };
}

export interface SquashOptions {
	codecs?: Codecs;
	onLog?: LogFn;
	pool?: SquashWorkerPool;
	/**
	 * Pre-decode input guards. Defaults: max 50 MB file size, max 100
	 * megapixels, animated GIFs rejected. Pass `false` per-field to disable a
	 * specific limit. See `validation.ts`.
	 */
	limits?: InputGateOptions;
	/**
	 * Cancel an in-flight run. When the signal aborts, `squash()` rejects with
	 * the signal's reason (an `AbortError` `DOMException` by default) at the
	 * next stage boundary. In-flight WASM work in a worker finishes but its
	 * result is discarded — this prevents a stale result from overwriting a
	 * newer one when the user swaps files quickly.
	 */
	signal?: AbortSignal;
}

export interface EncodedRaster {
	blob: Blob;
	width: number;
	height: number;
	mimeType: RasterMime;
}
