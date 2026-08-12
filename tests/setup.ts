// jsdom doesn't ship a full ImageData, and Canvas.toBlob is stubbed.
// For unit tests we use mock codecs and a minimal ImageData polyfill,
// so the real PNG/JPEG/AVIF WASM encoders are never invoked in jsdom.

// jsdom doesn't ship a real <canvas> implementation. Stub the 2d context for
// the PNG encode path (putImageData) and toBlob → return a marker PNG blob.
if (typeof HTMLCanvasElement !== "undefined") {
	HTMLCanvasElement.prototype.getContext = function (): CanvasRenderingContext2D {
		return {
			putImageData: () => {},
			drawImage: () => {},
			getImageData: () => new ImageData(1, 1),
		} as unknown as CanvasRenderingContext2D;
	};
	HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
		cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
	};
}

// jsdom's Blob doesn't implement arrayBuffer() in some versions — polyfill.
if (typeof Blob !== "undefined" && !Blob.prototype.arrayBuffer) {
	Blob.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as ArrayBuffer);
			reader.onerror = () => reject(reader.error);
			reader.readAsArrayBuffer(this);
		});
	};
}

if (typeof globalThis.ImageData === "undefined") {
	// Minimal ImageData shim — only fields the pipeline reads.
	class ImageDataShim {
		data: Uint8ClampedArray;
		width: number;
		height: number;
		colorSpace = "srgb" as const;
		constructor(data: Uint8ClampedArray | number, width?: number, height?: number) {
			if (data instanceof Uint8ClampedArray) {
				this.data = data;
				this.width = width!;
				this.height = height!;
			} else {
				// new ImageData(w, h)
				const w = data as number;
				const h = width as number;
				this.data = new Uint8ClampedArray(w * h * 4);
				this.width = w;
				this.height = h;
			}
		}
	}
	(globalThis as unknown as { ImageData: typeof ImageDataShim }).ImageData = ImageDataShim;
}
