/**
 * Main-thread codec layer: lazy-loads the jSquash WASM bundle (the worker keeps
 * its own per-codec loaders) and encodes a sized bitmap to a raster `Blob`. The
 * thread-agnostic encode steps it builds on live in `raster-ops.ts`.
 */
import type {
	Codecs,
	EncodedRaster,
	LogFn,
	RasterFormat,
} from "../types/squash";
import { encodePngBuffer } from "./raster-ops";

let cached: Codecs | null = null;

export async function defaultCodecs(log?: LogFn): Promise<Codecs> {
	if (cached) return cached;
	log?.("Loading WASM codecs...");
	const [jpegMod, pngMod, oxipngMod, avifMod, resizeMod] = await Promise.all([
		import("@jsquash/jpeg"),
		import("@jsquash/png"),
		import("@jsquash/oxipng"),
		import("@jsquash/avif"),
		import("@jsquash/resize"),
	]);
	cached = {
		jpegEncode: jpegMod.encode,
		jpegDecode: jpegMod.decode,
		pngDecode: pngMod.decode,
		pngEncode: pngMod.encode,
		oxipngOptimize: oxipngMod.optimise,
		avifEncode: avifMod.encode,
		resize: resizeMod.default,
	};
	log?.("Codecs loaded: MozJPEG, libpng, OxiPNG, AVIF, Resize");
	return cached;
}

export async function encodeRaster(
	codecs: Codecs,
	imageData: ImageData,
	quality: number,
	targetFormat: RasterFormat,
	log?: LogFn,
): Promise<EncodedRaster> {
	if (targetFormat === "png") {
		log?.(
			`Encoding ${imageData.width}x${imageData.height} as PNG (quality: ${quality}%, posterize+OxiPNG)`,
		);
		const buf = await encodePngBuffer(
			codecs.pngEncode,
			codecs.oxipngOptimize,
			imageData,
			quality,
		);
		return {
			blob: new Blob([buf], { type: "image/png" }),
			width: imageData.width,
			height: imageData.height,
			mimeType: "image/png",
		};
	}

	log?.(
		`Encoding ${imageData.width}x${imageData.height} as JPEG/MozJPEG (quality: ${quality}%)`,
	);
	const encoded = await codecs.jpegEncode(imageData, { quality });
	return {
		blob: new Blob([encoded], { type: "image/jpeg" }),
		width: imageData.width,
		height: imageData.height,
		mimeType: "image/jpeg",
	};
}
