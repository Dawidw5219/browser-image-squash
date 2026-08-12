import { useState } from "react";
import { SIZE_MAX_PX, SIZE_MIN_GAP_PX, SIZE_MIN_PX, type SizeKey } from "../../src";
import { CodeBlock } from "./CodeBlock";

export interface SettingsState {
	quality: number;
	sizes: Record<SizeKey, number>;
}

interface Props {
	value: SettingsState;
	onChange: (next: SettingsState) => void;
	onApply: () => void;
	disabled: boolean;
}

function buildConfigCode(state: SettingsState): string {
	const { quality, sizes } = state;
	return `import { initializeSquash, squash } from "browser-image-squash";

initializeSquash({
  quality: ${quality},
  sizes: { sm: ${sizes.sm}, md: ${sizes.md}, lg: ${sizes.lg} },
});

const result = await squash(file);
// → result.variants.{sm,md,lg,org}.{raster,avif}`;
}

const STEP = 20;
const snapDown = (n: number) => Math.floor(n / STEP) * STEP;
const snapUp = (n: number) => Math.ceil(n / STEP) * STEP;

function bounds(key: SizeKey, sizes: Record<SizeKey, number>): { min: number; max: number } {
	if (key === "sm")
		return { min: SIZE_MIN_PX, max: snapDown(sizes.md - SIZE_MIN_GAP_PX) };
	if (key === "md")
		return {
			min: snapUp(sizes.sm + SIZE_MIN_GAP_PX),
			max: snapDown(sizes.lg - SIZE_MIN_GAP_PX),
		};
	return { min: snapUp(sizes.md + SIZE_MIN_GAP_PX), max: SIZE_MAX_PX };
}

export function Settings({ value, onChange, onApply, disabled }: Props) {
	const [showCode, setShowCode] = useState(false);

	function setSize(key: SizeKey, n: number) {
		const b = bounds(key, value.sizes);
		const clamped = Math.min(Math.max(n, b.min), b.max);
		onChange({ ...value, sizes: { ...value.sizes, [key]: clamped } });
	}

	return (
		<div className="settings">
			{showCode ? (
				<div className="settings-code">
					<CodeBlock code={buildConfigCode(value)} />
				</div>
			) : (
				<div className="settings-controls">
					<label className="row">
						<span>
							Quality <b>{value.quality}</b>{" "}
							<span className="muted">(AVIF {Math.max(40, value.quality - 25)})</span>
						</span>
						<input
							type="range"
							min={40}
							max={95}
							value={value.quality}
							onChange={(e) => onChange({ ...value, quality: Number(e.target.value) })}
						/>
					</label>

					{(Object.keys(value.sizes) as SizeKey[]).map((k) => {
						const b = bounds(k, value.sizes);
						return (
							<label key={k} className="row size-row">
								<span>
									<code>{k}</code> <b>{value.sizes[k]}px</b>
								</span>
								<input
									type="range"
									min={b.min}
									max={b.max}
									step={STEP}
									value={value.sizes[k]}
									onChange={(e) => setSize(k, Number(e.target.value))}
								/>
							</label>
						);
					})}
				</div>
			)}

			<div className="settings-actions">
				<button className="link-btn" onClick={() => setShowCode((v) => !v)}>
					{showCode ? "Show controls" : "Show code"}
				</button>
				<button className="apply" onClick={onApply} disabled={disabled}>
					Re-squash
				</button>
			</div>
		</div>
	);
}
