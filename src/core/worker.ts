/// <reference lib="webworker" />

import type { AlphaAnalysis } from "../types/squash";
import {
	analyzeAlpha,
	applyOrientation,
	type ExifOrientation,
} from "./image-ops";
import { encodePngBuffer, resizeToMaxEdge } from "./raster-ops";

export type WorkerEncodeFormat = "png" | "jpeg" | "avif";
export type WorkerMime = "image/png" | "image/jpeg" | "image/avif";

/**
 * One-shot decode for the whole source: decode → orient → analyze alpha →
 * resize to every variant. All heavy pixel work happens here, off the main
 * thread, and the four sized `ImageData`s are transferred back (zero-copy) so
 * the caller can fan them out to encode jobs.
 */
export interface WorkerPrepRequest {
	type: "prep";
	id: number;
	buffer: ArrayBuffer;
	mimeType: string;
	orientation: ExifOrientation;
	sizes: { sm: number; md: number; lg: number; org: number | null };
}

/** Encode a single, already-sized-and-oriented `ImageData`. */
export interface WorkerEncodeRequest {
	type: "encode";
	id: number;
	imageData: ImageData;
	format: WorkerEncodeFormat;
	quality: number;
	avifSpeed?: number;
}

/** Preload every codec into this worker's cache; processes no input. */
export interface WorkerPreloadRequest {
	type: "preload";
	id: number;
}

export type WorkerRequest =
	| WorkerPrepRequest
	| WorkerEncodeRequest
	| WorkerPreloadRequest;

export type WorkerPrepResponse =
	| {
			type: "prep";
			id: number;
			ok: true;
			alpha: AlphaAnalysis;
			sourceWidth: number;
			sourceHeight: number;
			sm: ImageData;
			md: ImageData;
			lg: ImageData;
			org: ImageData;
	  }
	| { type: "prep"; id: number; ok: false; error: string };

export type WorkerEncodeResponse =
	| {
			type: "encode";
			id: number;
			ok: true;
			buffer: ArrayBuffer;
			width: number;
			height: number;
			mimeType: WorkerMime;
	  }
	| { type: "encode"; id: number; ok: false; error: string };

export type WorkerPreloadResponse =
	| { type: "preload"; id: number; ok: true }
	| { type: "preload"; id: number; ok: false; error: string };

export type WorkerResponse =
	| WorkerPrepResponse
	| WorkerEncodeResponse
	| WorkerPreloadResponse;

function lazy<T>(load: () => Promise<T>): () => Promise<T> {
	let cached: Promise<T> | null = null;
	return () => (cached ??= load());
}

const loadJpeg = lazy(() => import("@jsquash/jpeg"));
const loadPng = lazy(() => import("@jsquash/png"));
const loadOxipng = lazy(() => import("@jsquash/oxipng"));
const loadAvif = lazy(() => import("@jsquash/avif"));
const loadResize = lazy(() => import("@jsquash/resize"));

async function decodeBuffer(buffer: ArrayBuffer, mimeType: string): Promise<ImageData> {
	if (mimeType === "image/png") {
		const { decode } = await loadPng();
		return decode(buffer);
	}
	if (mimeType === "image/jpeg") {
		const { decode } = await loadJpeg();
		return decode(buffer);
	}
	// WebP / GIF / BMP / (Safari-only) HEIC go through the browser decoder.
	const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
	let bmp: ImageBitmap;
	try {
		bmp = await createImageBitmap(blob);
	} catch {
		throw new Error(
			`Could not decode "${mimeType}". This browser cannot decode this format ` +
				`(HEIC/HEIF decode requires Safari). Convert to JPEG/PNG/WebP first.`,
		);
	}
	const canvas = new OffscreenCanvas(bmp.width, bmp.height);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");
	ctx.drawImage(bmp, 0, 0);
	bmp.close();
	return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function encodeOne(
	data: ImageData,
	format: WorkerEncodeFormat,
	quality: number,
	avifSpeed?: number,
): Promise<{ buffer: ArrayBuffer; mimeType: WorkerMime }> {
	if (format === "avif") {
		const { encode } = await loadAvif();
		const buf = await encode(data, { quality, speed: avifSpeed });
		return { buffer: buf, mimeType: "image/avif" };
	}
	if (format === "jpeg") {
		const { encode } = await loadJpeg();
		const buf = await encode(data, { quality });
		return { buffer: buf, mimeType: "image/jpeg" };
	}
	const { encode: pngEncode } = await loadPng();
	const { optimise } = await loadOxipng();
	const optimized = await encodePngBuffer(pngEncode, optimise, data, quality);
	return { buffer: optimized, mimeType: "image/png" };
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

async function handlePrep(req: WorkerPrepRequest): Promise<void> {
	try {
		const decoded = await decodeBuffer(req.buffer, req.mimeType);
		const source =
			req.orientation !== 1 ? applyOrientation(decoded, req.orientation) : decoded;
		const alpha = analyzeAlpha(source);

		// Build one independent buffer per variant. `org` claims the full image
		// (no copy) when it isn't downscaled; any other variant that also lands
		// at full size gets a deep copy so every returned buffer is unique and
		// safe to transfer.
		const order = [
			{ key: "org" as const, maxEdge: req.sizes.org },
			{ key: "lg" as const, maxEdge: req.sizes.lg },
			{ key: "md" as const, maxEdge: req.sizes.md },
			{ key: "sm" as const, maxEdge: req.sizes.sm },
		];
		const out = {} as Record<"sm" | "md" | "lg" | "org", ImageData>;
		let fullClaimed = false;
		for (const { key, maxEdge } of order) {
			const r = await resizeToMaxEdge(
				async () => (await loadResize()).default,
				source,
				maxEdge,
			);
			if (r.resized) {
				out[key] = r.data;
			} else if (!fullClaimed) {
				out[key] = r.data;
				fullClaimed = true;
			} else {
				out[key] = new ImageData(
					new Uint8ClampedArray(r.data.data),
					r.data.width,
					r.data.height,
				);
			}
		}

		const resp: WorkerPrepResponse = {
			type: "prep",
			id: req.id,
			ok: true,
			alpha,
			sourceWidth: source.width,
			sourceHeight: source.height,
			sm: out.sm,
			md: out.md,
			lg: out.lg,
			org: out.org,
		};
		scope.postMessage(resp, [
			out.sm.data.buffer,
			out.md.data.buffer,
			out.lg.data.buffer,
			out.org.data.buffer,
		]);
	} catch (err) {
		const resp: WorkerPrepResponse = {
			type: "prep",
			id: req.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
		scope.postMessage(resp);
	}
}

async function handleEncode(req: WorkerEncodeRequest): Promise<void> {
	try {
		const { buffer, mimeType } = await encodeOne(
			req.imageData,
			req.format,
			req.quality,
			req.avifSpeed,
		);
		const resp: WorkerEncodeResponse = {
			type: "encode",
			id: req.id,
			ok: true,
			buffer,
			width: req.imageData.width,
			height: req.imageData.height,
			mimeType,
		};
		scope.postMessage(resp, [buffer]);
	} catch (err) {
		const resp: WorkerEncodeResponse = {
			type: "encode",
			id: req.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
		scope.postMessage(resp);
	}
}

async function handlePreload(req: WorkerPreloadRequest): Promise<void> {
	try {
		await Promise.all([
			loadJpeg(),
			loadPng(),
			loadOxipng(),
			loadAvif(),
			loadResize(),
		]);
		const resp: WorkerPreloadResponse = { type: "preload", id: req.id, ok: true };
		scope.postMessage(resp);
	} catch (err) {
		const resp: WorkerPreloadResponse = {
			type: "preload",
			id: req.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
		scope.postMessage(resp);
	}
}

scope.addEventListener("message", (e: MessageEvent<WorkerRequest>) => {
	if (e.data.type === "prep") void handlePrep(e.data);
	else if (e.data.type === "encode") void handleEncode(e.data);
	else void handlePreload(e.data);
});
