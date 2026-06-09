import type { SquashResult } from "../../src";

interface Props {
	result: SquashResult;
	sourceBytes: number;
	elapsedMs: number | null;
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function Stats({ result, sourceBytes, elapsedMs }: Props) {
	let totalRaster = 0;
	let totalAvif = 0;
	for (const v of Object.values(result.variants)) {
		totalRaster += v.raster.blob.size;
		totalAvif += v.avif.blob.size;
	}
	const total = totalRaster + totalAvif;

	return (
		<div className="stats">
			<div className="stat">
				<div className="label">Format</div>
				<div className="value">{result.format.toUpperCase()} + AVIF</div>
				<div className="sub">
					{result.alpha.nonOpaque}/{result.alpha.total} non-opaque ({(result.alpha.ratio * 100).toFixed(2)}%)
				</div>
			</div>
			<div className="stat">
				<div className="label">Source</div>
				<div className="value">
					{result.source.width}×{result.source.height}
				</div>
				<div className="sub">{formatBytes(sourceBytes)}</div>
			</div>
			<div className="stat">
				<div className="label">All outputs</div>
				<div className="value">{formatBytes(total)}</div>
				<div className="sub">
					raster {formatBytes(totalRaster)} · avif {formatBytes(totalAvif)}
				</div>
			</div>
			<div className="stat">
				<div className="label">Time</div>
				<div className="value">{elapsedMs !== null ? `${elapsedMs.toFixed(0)} ms` : "—"}</div>
				<div className="sub">8 outputs · {(elapsedMs ? elapsedMs / 8 : 0).toFixed(0)} ms each</div>
			</div>
		</div>
	);
}
