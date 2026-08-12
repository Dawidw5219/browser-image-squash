import { defaultCodecs, encodeRaster } from "./codecs";
import {
	analyzeAlpha,
	applyOrientation,
	readJpegOrientation,
} from "./image-ops";
import { estimateJpegQuality } from "./jpeg-quality";
import { resizeToMaxEdge } from "./raster-ops";
import { ImageDecodeError, validateInput } from "./validation";
import {
	ORG_AVIF_QUALITY,
	ORG_RASTER_QUALITY,
	SIZE_KEYS,
	type SquashSizeKey,
	type SquashVariantKey,
	getConfig,
} from "./config";
import type {
	AvifBlob,
	Codecs,
	LogFn,
	RasterBlob,
	RasterFormat,
	SquashResult,
	SquashOptions,
	VariantResult,
} from "../types/squash";
import {
	getDefaultPool,
	isWorkerEnvAvailable,
	type SquashWorkerPool,
} from "./worker-pool";

async function toBuffer(
	input: Blob | ArrayBuffer | File,
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
	if (input instanceof ArrayBuffer)
		return { buffer: input, mimeType: "application/octet-stream" };
	const blob = input as Blob;
	return {
		buffer: await blob.arrayBuffer(),
		mimeType: blob.type || "application/octet-stream",
	};
}

/**
 * Reject as soon as `signal` aborts, even while `p` is still running. The
 * underlying work isn't forcibly killed (WASM in a worker can't be interrupted
 * mid-call), but its result is abandoned — which is what callers need to avoid
 * a stale result landing after a newer request.
 */
function abortRace<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return p;
	if (signal.aborted) return Promise.reject(signal.reason);
	const { promise, resolve, reject } = Promise.withResolvers<T>();
	const onAbort = () => reject(signal.reason);
	signal.addEventListener("abort", onAbort, { once: true });
	p.then(resolve, reject).finally(() =>
		signal.removeEventListener("abort", onAbort),
	);
	return promise;
}

async function decodeImageMain(
	codecs: Codecs,
	buffer: ArrayBuffer,
	mimeType: string,
): Promise<ImageData> {
	if (mimeType === "image/png") return codecs.pngDecode(buffer);
	if (mimeType === "image/jpeg") return codecs.jpegDecode(buffer);
	const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
	let bmp: ImageBitmap;
	try {
		bmp = await createImageBitmap(blob);
	} catch {
		throw new ImageDecodeError(
			`Could not decode "${mimeType}". This browser cannot decode this format ` +
				`(HEIC/HEIF decode requires Safari). Convert to JPEG/PNG/WebP first.`,
		);
	}
	const canvas = document.createElement("canvas");
	canvas.width = bmp.width;
	canvas.height = bmp.height;
	const ctx = canvas.getContext("2d")!;
	ctx.drawImage(bmp, 0, 0);
	return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function makeRasterAtSizeMain(
	codecs: Codecs,
	source: ImageData,
	maxEdge: number | null,
	quality: number,
	format: RasterFormat,
	log: LogFn,
): Promise<VariantResult["raster"]> {
	const { data } = await resizeToMaxEdge(async () => codecs.resize, source, maxEdge);
	return encodeRaster(codecs, data, quality, format, log);
}

async function makeAvifAtSizeMain(
	codecs: Codecs,
	source: ImageData,
	maxEdge: number | null,
	quality: number,
	speed: number,
	log: LogFn,
): Promise<AvifBlob> {
	const { data } = await resizeToMaxEdge(async () => codecs.resize, source, maxEdge);
	log(`Encoding ${data.width}x${data.height} as AVIF (quality: ${quality}%, speed: ${speed})`);
	const buf = await codecs.avifEncode(data, { quality, speed });
	return {
		blob: new Blob([buf], { type: "image/avif" }),
		width: data.width,
		height: data.height,
		mimeType: "image/avif",
	};
}

async function runMainThread(
	buffer: ArrayBuffer,
	mimeType: string,
	codecs: Codecs,
	log: LogFn,
	signal?: AbortSignal,
): Promise<SquashResult> {
	const config = getConfig();
	let source = await decodeImageMain(codecs, buffer, mimeType);
	if (mimeType === "image/jpeg") {
		const orient = readJpegOrientation(buffer);
		if (orient !== 1) {
			log(`[orientation] EXIF=${orient} — rotating pixels`);
			source = applyOrientation(source, orient);
		}
	}
	log(`[source] ${source.width}x${source.height} (${mimeType})`);

	const alpha = analyzeAlpha(source);
	const format: RasterFormat = alpha.isTransparent ? "png" : "jpeg";
	log(
		`[format] ${alpha.nonOpaque}/${alpha.total} non-opaque (${(alpha.ratio * 100).toFixed(2)}%) → ${format.toUpperCase()}`,
	);

	const sourceJpegQ =
		mimeType === "image/jpeg" && format === "jpeg" ? estimateJpegQuality(buffer) : null;
	if (sourceJpegQ !== null) {
		log(`[source-quality] JPEG q≈${sourceJpegQ} — raster encodes clamped to ≤${sourceJpegQ}`);
	}
	const clampRaster = (target: number): number =>
		sourceJpegQ !== null ? Math.min(target, sourceJpegQ) : target;

	const variants = {} as Record<SquashVariantKey, VariantResult>;

	for (const key of SIZE_KEYS) {
		signal?.throwIfAborted();
		const sizeKey = key as SquashSizeKey;
		const maxEdge = config.sizes[sizeKey];
		const raster = await makeRasterAtSizeMain(
			codecs,
			source,
			maxEdge,
			clampRaster(config.quality),
			format,
			(msg) => log(`[${sizeKey}] ${msg}`),
		);
		log(`[${sizeKey}] raster ${raster.width}x${raster.height}, ${raster.blob.size}B`);

		const avif = await makeAvifAtSizeMain(
			codecs,
			source,
			maxEdge,
			config.avifQuality,
			config.avifSpeed,
			(msg) => log(`[${sizeKey}/avif] ${msg}`),
		);
		log(`[${sizeKey}/avif] ${avif.width}x${avif.height}, ${avif.blob.size}B`);

		variants[sizeKey] = { raster, avif };
	}

	signal?.throwIfAborted();
	const orgMaxEdge = config.sizes.org;
	const orgRaster = await makeRasterAtSizeMain(
		codecs,
		source,
		orgMaxEdge,
		clampRaster(ORG_RASTER_QUALITY),
		format,
		(msg) => log(`[org] ${msg}`),
	);
	log(`[org] raster ${orgRaster.width}x${orgRaster.height}, ${orgRaster.blob.size}B`);

	const orgAvif = await makeAvifAtSizeMain(
		codecs,
		source,
		orgMaxEdge,
		ORG_AVIF_QUALITY,
		config.avifSpeed,
		(msg) => log(`[org/avif] ${msg}`),
	);
	log(`[org/avif] ${orgAvif.width}x${orgAvif.height}, ${orgAvif.blob.size}B`);

	variants.org = { raster: orgRaster, avif: orgAvif };

	return {
		variants,
		format,
		alpha,
		source: { width: source.width, height: source.height, mimeType },
	};
}

async function runWorkers(
	buffer: ArrayBuffer,
	mimeType: string,
	pool: SquashWorkerPool,
	log: LogFn,
	signal?: AbortSignal,
): Promise<SquashResult> {
	const config = getConfig();
	log(`Worker pool: ${pool.size} workers`);

	const orientation = mimeType === "image/jpeg" ? readJpegOrientation(buffer) : 1;
	if (orientation !== 1) log(`[orientation] EXIF=${orientation} — rotating pixels in worker`);

	const prepStart = performance.now();
	const prep = await abortRace(
		pool.prep({ buffer, mimeType, orientation, sizes: config.sizes }),
		signal,
	);
	const { alpha } = prep;
	const format: RasterFormat = alpha.isTransparent ? "png" : "jpeg";
	log(
		`[source] ${prep.sourceWidth}x${prep.sourceHeight} (${mimeType}) prepped in ${(performance.now() - prepStart).toFixed(0)}ms`,
	);
	log(
		`[format] ${alpha.nonOpaque}/${alpha.total} non-opaque (${(alpha.ratio * 100).toFixed(2)}%) → ${format.toUpperCase()}`,
	);

	const sourceJpegQ =
		mimeType === "image/jpeg" && format === "jpeg" ? estimateJpegQuality(buffer) : null;
	if (sourceJpegQ !== null) {
		log(`[source-quality] JPEG q≈${sourceJpegQ} — raster encodes clamped to ≤${sourceJpegQ}`);
	}
	const clampRaster = (target: number): number =>
		sourceJpegQ !== null ? Math.min(target, sourceJpegQ) : target;

	const sized: Record<SquashVariantKey, ImageData> = {
		sm: prep.sm,
		md: prep.md,
		lg: prep.lg,
		org: prep.org,
	};

	const jobs: Array<{
		variant: SquashVariantKey;
		kind: "raster" | "avif";
		t0: number;
		promise: Promise<{ buffer: ArrayBuffer; width: number; height: number; mimeType: string }>;
	}> = [];
	const startedAt = performance.now();

	for (const key of SIZE_KEYS) {
		const sizeKey = key as SquashSizeKey;
		jobs.push({
			variant: sizeKey,
			kind: "raster",
			t0: startedAt,
			promise: pool.encode({
				imageData: sized[sizeKey],
				format,
				quality: clampRaster(config.quality),
			}),
		});
		jobs.push({
			variant: sizeKey,
			kind: "avif",
			t0: startedAt,
			promise: pool.encode({
				imageData: sized[sizeKey],
				format: "avif",
				quality: config.avifQuality,
				avifSpeed: config.avifSpeed,
			}),
		});
	}
	jobs.push({
		variant: "org",
		kind: "raster",
		t0: startedAt,
		promise: pool.encode({
			imageData: sized.org,
			format,
			quality: clampRaster(ORG_RASTER_QUALITY),
		}),
	});
	jobs.push({
		variant: "org",
		kind: "avif",
		t0: startedAt,
		promise: pool.encode({
			imageData: sized.org,
			format: "avif",
			quality: ORG_AVIF_QUALITY,
			avifSpeed: config.avifSpeed,
		}),
	});

	const results = await abortRace(
		Promise.all(
			jobs.map(async (j) => {
				const r = await j.promise;
				log(
					`[${j.variant}/${j.kind}] ${r.width}x${r.height}, ${r.buffer.byteLength}B (+${(performance.now() - j.t0).toFixed(0)}ms)`,
				);
				return { ...j, result: r };
			}),
		),
		signal,
	);

	const variants = {} as Record<SquashVariantKey, VariantResult>;
	const ensure = (k: SquashVariantKey): Partial<VariantResult> => {
		if (!variants[k]) variants[k] = {} as VariantResult;
		return variants[k] as Partial<VariantResult>;
	};

	for (const r of results) {
		const slot = ensure(r.variant);
		const blob = new Blob([r.result.buffer], { type: r.result.mimeType });
		if (r.kind === "raster") {
			slot.raster = {
				blob,
				width: r.result.width,
				height: r.result.height,
				mimeType: r.result.mimeType as RasterBlob["mimeType"],
			};
		} else {
			slot.avif = {
				blob,
				width: r.result.width,
				height: r.result.height,
				mimeType: "image/avif",
			};
		}
	}

	return {
		variants,
		format,
		alpha,
		source: { width: prep.sourceWidth, height: prep.sourceHeight, mimeType },
	};
}

function applyOrgRasterFallback(
	result: SquashResult,
	sourceBuffer: ArrayBuffer,
	sourceMime: string,
	log: LogFn,
): SquashResult {
	const sameFormat =
		(sourceMime === "image/jpeg" && result.format === "jpeg") ||
		(sourceMime === "image/png" && result.format === "png");
	if (!sameFormat) return result;
	const orgRaster = result.variants.org?.raster;
	if (!orgRaster) return result;
	if (orgRaster.blob.size <= sourceBuffer.byteLength) return result;
	log(
		`[org] re-encoded raster ${orgRaster.blob.size}B > source ${sourceBuffer.byteLength}B → keep source`,
	);
	result.variants.org.raster = {
		blob: new Blob([sourceBuffer], { type: sourceMime }),
		width: orgRaster.width,
		height: orgRaster.height,
		mimeType: sourceMime as RasterBlob["mimeType"],
	};
	return result;
}

export async function squash(
	input: Blob | ArrayBuffer | File,
	options: SquashOptions = {},
): Promise<SquashResult> {
	const log: LogFn = options.onLog ?? (() => {});
	const { signal } = options;
	signal?.throwIfAborted();

	const { buffer, mimeType } = await toBuffer(input);
	signal?.throwIfAborted();

	// Fail fast on inputs that could DoS the encoder or that we deliberately
	// don't support (animated GIFs, oversized images, image bombs). Per-call
	// `options.limits` overrides global `initializeSquash({ limits })` config.
	validateInput(buffer, mimeType, options.limits ?? getConfig().limits);

	if (options.codecs) {
		const r = await runMainThread(buffer, mimeType, options.codecs, log, signal);
		return applyOrgRasterFallback(r, buffer, mimeType, log);
	}

	if (isWorkerEnvAvailable()) {
		try {
			const pool = options.pool ?? getDefaultPool();
			const r = await runWorkers(buffer, mimeType, pool, log, signal);
			return applyOrgRasterFallback(r, buffer, mimeType, log);
		} catch (err) {
			// An abort is intentional — don't mask it as a worker failure and
			// re-run the whole thing on the main thread.
			if (signal?.aborted) throw err;
			log(`Worker pool failed, falling back to main thread: ${String(err)}`);
		}
	}

	const codecs = await defaultCodecs(log);
	const r = await runMainThread(buffer, mimeType, codecs, log, signal);
	return applyOrgRasterFallback(r, buffer, mimeType, log);
}

/**
 * Eagerly load every WASM codec before the first `squash()`, so the first real
 * run is instant instead of paying the one-time codec download mid-encode.
 * Primes the worker pool when workers are available, otherwise the main-thread
 * codecs. Purely optional — `squash()` self-loads on demand if you skip this.
 */
export async function preload(): Promise<void> {
	if (isWorkerEnvAvailable()) {
		try {
			await getDefaultPool().preload();
			return;
		} catch {
			// Worker environment unusable — fall back to main-thread codecs.
		}
	}
	await defaultCodecs();
}
