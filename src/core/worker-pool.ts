import type { AlphaAnalysis } from "../types/squash";
import type { ExifOrientation } from "./image-ops";
import type {
	WorkerEncodeFormat,
	WorkerEncodeRequest,
	WorkerMime,
	WorkerPrepRequest,
	WorkerRequest,
	WorkerResponse,
	WorkerPreloadRequest,
} from "./worker";

export interface PrepJob {
	buffer: ArrayBuffer;
	mimeType: string;
	orientation: ExifOrientation;
	sizes: { sm: number; md: number; lg: number; org: number | null };
}

export interface PrepResult {
	alpha: AlphaAnalysis;
	sourceWidth: number;
	sourceHeight: number;
	sm: ImageData;
	md: ImageData;
	lg: ImageData;
	org: ImageData;
}

export interface EncodeJob {
	imageData: ImageData;
	format: WorkerEncodeFormat;
	quality: number;
	avifSpeed?: number;
}

export interface EncodeResult {
	buffer: ArrayBuffer;
	width: number;
	height: number;
	mimeType: WorkerMime;
}

type PendingJob =
	| {
			kind: "prep";
			req: Omit<WorkerPrepRequest, "id">;
			resolve: (r: PrepResult) => void;
			reject: (e: Error) => void;
	  }
	| {
			kind: "encode";
			req: Omit<WorkerEncodeRequest, "id">;
			resolve: (r: EncodeResult) => void;
			reject: (e: Error) => void;
	  }
	| {
			kind: "preload";
			req: Omit<WorkerPreloadRequest, "id">;
			resolve: () => void;
			reject: (e: Error) => void;
	  };

export class SquashWorkerPool {
	private workers: Worker[] = [];
	private idle: Worker[] = [];
	private queue: PendingJob[] = [];
	private inflight = new Map<number, { worker: Worker; pending: PendingJob }>();
	private nextId = 0;

	constructor(size: number) {
		const count = Math.max(1, Math.min(size, 16));
		for (let i = 0; i < count; i++) {
			const w = new Worker(new URL("./worker.ts", import.meta.url), {
				type: "module",
			});
			w.addEventListener("message", (e: MessageEvent<WorkerResponse>) => {
				this.handle(w, e.data);
			});
			w.addEventListener("error", (e: ErrorEvent) => {
				this.failAll(new Error(`Worker error: ${e.message}`));
			});
			this.workers.push(w);
			this.idle.push(w);
		}
	}

	get size(): number {
		return this.workers.length;
	}

	prep(job: PrepJob): Promise<PrepResult> {
		return new Promise<PrepResult>((resolve, reject) => {
			this.enqueue({
				kind: "prep",
				req: { type: "prep", ...job },
				resolve,
				reject,
			});
		});
	}

	encode(job: EncodeJob): Promise<EncodeResult> {
		return new Promise<EncodeResult>((resolve, reject) => {
			this.enqueue({
				kind: "encode",
				req: { type: "encode", ...job },
				resolve,
				reject,
			});
		});
	}

	/**
	 * Broadcast a preload to every worker so each one's codec cache is primed.
	 * Resolves once all workers report ready. Optional — pools self-load on use.
	 */
	preload(): Promise<void> {
		const all = this.workers.map((w) => {
			const { promise, resolve, reject } = Promise.withResolvers<void>();
			this.dispatch(w, {
				kind: "preload",
				req: { type: "preload" },
				resolve,
				reject,
			});
			return promise;
		});
		return Promise.all(all).then(() => undefined);
	}

	terminate(): void {
		for (const w of this.workers) w.terminate();
		this.workers = [];
		this.idle = [];
		this.queue = [];
		this.inflight.clear();
	}

	private enqueue(p: PendingJob): void {
		const w = this.idle.pop();
		if (w) this.dispatch(w, p);
		else this.queue.push(p);
	}

	private dispatch(w: Worker, p: PendingJob): void {
		const id = this.nextId++;
		this.inflight.set(id, { worker: w, pending: p });
		w.postMessage({ ...p.req, id } as WorkerRequest);
	}

	private handle(w: Worker, res: WorkerResponse): void {
		const entry = this.inflight.get(res.id);
		if (!entry) return;
		this.inflight.delete(res.id);
		const { pending } = entry;
		if (!res.ok) {
			pending.reject(new Error(res.error));
		} else if (res.type === "prep" && pending.kind === "prep") {
			pending.resolve({
				alpha: res.alpha,
				sourceWidth: res.sourceWidth,
				sourceHeight: res.sourceHeight,
				sm: res.sm,
				md: res.md,
				lg: res.lg,
				org: res.org,
			});
		} else if (res.type === "encode" && pending.kind === "encode") {
			pending.resolve({
				buffer: res.buffer,
				width: res.width,
				height: res.height,
				mimeType: res.mimeType,
			});
	} else if (res.type === "preload" && pending.kind === "preload") {
		pending.resolve();
	} else {
			pending.reject(new Error(`Pool: response type mismatch (${res.type})`));
		}
	// A preload is broadcast straight to each worker without taking an idle
	// slot, so it must not drive the idle/queue reclamation below.
	if (pending.kind === "preload") return;
		const next = this.queue.shift();
		if (next) this.dispatch(w, next);
		else this.idle.push(w);
	}

	private failAll(err: Error): void {
		for (const { pending } of this.inflight.values()) pending.reject(err);
		for (const p of this.queue) p.reject(err);
		this.inflight.clear();
		this.queue = [];
	}
}

let defaultPool: SquashWorkerPool | null = null;

export function getDefaultPool(): SquashWorkerPool {
	if (defaultPool) return defaultPool;
	const hwc =
		typeof navigator !== "undefined" && navigator.hardwareConcurrency
			? navigator.hardwareConcurrency
			: 4;
	const size = Math.max(2, Math.min(hwc, 8));
	defaultPool = new SquashWorkerPool(size);
	return defaultPool;
}

export function isWorkerEnvAvailable(): boolean {
	return typeof Worker !== "undefined";
}
