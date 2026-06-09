import { useState } from "react";
import { initializeSquash, squash } from "../src";
import type { SizeKey, SquashResult, VariantKey } from "../src";
import { CompareView } from "./components/CompareView";
import { Dropzone } from "./components/Dropzone";
import { Settings, type SettingsState } from "./components/Settings";

const DEFAULT_SETTINGS: SettingsState = {
	quality: 80,
	sizes: { sm: 640, md: 1280, lg: 1920 },
};

export function App() {
	const [file, setFile] = useState<File | null>(null);
	const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
	const [result, setResult] = useState<SquashResult | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pickedVariant, setPickedVariant] = useState<VariantKey>("org");
	const [pickedFormat, setPickedFormat] = useState<"raster" | "avif">("avif");

	async function run(input: File, s: SettingsState) {
		setBusy(true);
		setError(null);
		setResult(null);
		try {
			initializeSquash({ quality: s.quality, sizes: s.sizes });
			const r = await squash(input);
			setResult(r);
		} catch (err) {
			setError(String(err));
		} finally {
			setBusy(false);
		}
	}

	function onFile(f: File) {
		setFile(f);
		void run(f, settings);
	}

	function rerun() {
		if (file) void run(file, settings);
	}

	return (
		<div className="app">
			<header className="header">
				<h1>Browser Image Squash</h1>
				<p className="tagline">
					Client-side image optimization for the browser. Drop an image, get four sizes ×
					two formats (AVIF + JPEG/PNG) encoded in Web Workers using WASM codecs.
				</p>
			</header>

			<main className="main">
				<section className="controls">
					<Dropzone file={file} onFile={onFile} busy={busy} />
					<Settings value={settings} onChange={setSettings} onApply={rerun} disabled={!file || busy} />
				</section>

				<section className="output">
					{error && <div className="error">{error}</div>}
					{busy && (
						<div className="processing">
							<div className="spinner" />
							<span>Squashing…</span>
						</div>
					)}
					{result && (
						<CompareView
							file={file}
							result={result}
							sourceBytes={file?.size ?? 0}
							pickedVariant={pickedVariant}
							pickedFormat={pickedFormat}
							onPickVariant={setPickedVariant}
							onPickFormat={setPickedFormat}
						/>
					)}
					{!result && !error && !busy && <div className="empty">Drop an image to start.</div>}
				</section>
			</main>

		</div>
	);
}

export type { SizeKey };
