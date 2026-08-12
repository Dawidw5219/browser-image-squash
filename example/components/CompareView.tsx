import { useCallback, useEffect, useRef, useState } from "react";
import type { SquashResult, VariantKey } from "../../src";

interface Props {
	file: File | null;
	result: SquashResult;
	sourceBytes: number;
	pickedVariant: VariantKey;
	pickedFormat: "raster" | "avif";
	onPickVariant: (v: VariantKey) => void;
	onPickFormat: (f: "raster" | "avif") => void;
}

const VARIANT_KEYS: VariantKey[] = ["sm", "md", "lg", "org"];

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function reductionInfo(
	blobBytes: number,
	sourceBytes: number,
	digits = 1,
): { text: string; positive: boolean } {
	if (!sourceBytes) return { text: "—", positive: true };
	const pct = (1 - blobBytes / sourceBytes) * 100;
	if (pct >= 0) return { text: `−${pct.toFixed(digits)}%`, positive: true };
	return { text: `+${Math.abs(pct).toFixed(digits)}%`, positive: false };
}

function useObjectUrl(blob: Blob | null | undefined): string {
	const [url, setUrl] = useState("");
	useEffect(() => {
		if (!blob) {
			setUrl("");
			return;
		}
		const u = URL.createObjectURL(blob);
		setUrl(u);
		return () => URL.revokeObjectURL(u);
	}, [blob]);
	return url;
}

function downloadBlob(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CompareView({
	file,
	result,
	sourceBytes,
	pickedVariant,
	pickedFormat,
	onPickVariant,
	onPickFormat,
}: Props) {
	const variant = result.variants[pickedVariant];
	const picked = pickedFormat === "avif" ? variant.avif : variant.raster;
	const optimizedUrl = useObjectUrl(picked.blob);
	const originalUrl = useObjectUrl(file);
	const rasterExt = result.format;
	const avifOn = pickedFormat === "avif";

	const [pos, setPos] = useState(50);
	const dragRef = useRef<HTMLDivElement | null>(null);
	const frameRef = useRef<HTMLDivElement | null>(null);
	const dragging = useRef(false);

	useEffect(() => {
		const f = frameRef.current;
		if (!f) return;
		f.scrollLeft = Math.max(0, (f.scrollWidth - f.clientWidth) / 2);
	}, [pickedVariant, pickedFormat, picked.width, picked.height]);

	const setFromClientX = useCallback((clientX: number) => {
		const el = dragRef.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		const x = Math.min(Math.max(clientX - r.left, 0), r.width);
		setPos((x / r.width) * 100);
	}, []);

	useEffect(() => {
		const onMove = (e: MouseEvent) => {
			if (dragging.current) setFromClientX(e.clientX);
		};
		const onTouch = (e: TouchEvent) => {
			if (dragging.current && e.touches[0]) setFromClientX(e.touches[0].clientX);
		};
		const stop = () => {
			dragging.current = false;
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("touchmove", onTouch, { passive: true });
		window.addEventListener("mouseup", stop);
		window.addEventListener("touchend", stop);
		return () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("touchmove", onTouch);
			window.removeEventListener("mouseup", stop);
			window.removeEventListener("touchend", stop);
		};
	}, [setFromClientX]);

	const startDrag = (clientX: number) => {
		dragging.current = true;
		setFromClientX(clientX);
	};

	return (
		<div className="compare">
			<div className="big-switch-bar">
				<span className={`switch-side ${!avifOn ? "active" : ""}`}>AVIF OFF</span>
				<button
					className={`big-switch ${avifOn ? "on" : "off"}`}
					onClick={() => onPickFormat(avifOn ? "raster" : "avif")}
					aria-label={avifOn ? "Turn AVIF off" : "Turn AVIF on"}
				>
					<span className="big-switch-thumb" />
				</button>
				<span className={`switch-side ${avifOn ? "active" : ""}`}>AVIF ON</span>
			</div>

			<div className="compare-pills">
				{VARIANT_KEYS.map((k) => {
					const v = pickedFormat === "avif" ? result.variants[k].avif : result.variants[k].raster;
					const r = reductionInfo(v.blob.size, sourceBytes, 0);
					const variantExt = pickedFormat === "avif" ? "avif" : rasterExt;
					const isPillPassthrough =
						k === "org" &&
						pickedFormat === "raster" &&
						v.blob.size === sourceBytes &&
						v.mimeType === result.source.mimeType;
					return (
						<button
							key={k}
							className={`pill-card ${pickedVariant === k ? "active" : ""}`}
							onClick={() => onPickVariant(k)}
						>
							<div className="pill-card-top">
								<span className="pill-card-key">{k}</span>
								<span className="pill-card-dim">
									{v.width}×{v.height}
								</span>
							</div>
							<div className="pill-card-bottom">
								<span className="pill-card-size">{formatBytes(v.blob.size)}</span>
								<span className={`pill-card-pct ${r.positive ? "good" : "bad"}`}>{r.text}</span>
							</div>
							<span
								className={`pill-dl ${isPillPassthrough ? "disabled" : ""}`}
								title={
									isPillPassthrough
										? "Same as source"
										: `Download ${k}.${variantExt}`
								}
								role="button"
								onClick={(e) => {
									e.stopPropagation();
									if (!isPillPassthrough) downloadBlob(v.blob, `${k}.${variantExt}`);
								}}
							>
								↓
							</span>
						</button>
					);
				})}
			</div>

			<div className="slider-wrap">
				<div className="slider-frame" ref={frameRef}>
					<div
						className="slider"
						ref={dragRef}
						style={{
							width: `${picked.width}px`,
							aspectRatio: `${picked.width} / ${picked.height}`,
						}}
						onMouseDown={(e) => startDrag(e.clientX)}
						onTouchStart={(e) => {
							if (e.touches[0]) startDrag(e.touches[0].clientX);
						}}
					>
						{originalUrl && (
							<img
								src={originalUrl}
								alt="original"
								className="slider-img slider-base"
								draggable={false}
							/>
						)}
						{optimizedUrl && (
							<div
								className="slider-overlay"
								style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
							>
								<img
									src={optimizedUrl}
									alt="optimized"
									className="slider-img"
									draggable={false}
								/>
							</div>
						)}
						<div className="slider-handle" style={{ left: `${pos}%` }}>
							<div className="slider-handle-bar" />
							<div className="slider-handle-grip">⇆</div>
						</div>
					</div>
				</div>
				<div className="slider-badge slider-badge-left">
					<span className="badge-title">ORIGINAL</span>
					<span className="badge-size">{formatBytes(sourceBytes)}</span>
				</div>
				<div className={`slider-badge slider-badge-right ${avifOn ? "is-on" : "is-off"}`}>
					<span className="badge-title">
						AVIF <b>{avifOn ? "ON" : "OFF"}</b>
					</span>
					<span className="badge-size">{formatBytes(picked.blob.size)}</span>
				</div>
			</div>
		</div>
	);
}
