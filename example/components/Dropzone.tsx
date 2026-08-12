import { useCallback, useState } from "react";

interface Props {
	file: File | null;
	onFile: (file: File) => void;
	busy: boolean;
}

const RANDOM_PRESETS = [
	{ label: "landscape", w: 3000, h: 2000 },
	{ label: "portrait", w: 2000, h: 3000 },
	{ label: "square", w: 2400, h: 2400 },
] as const;

async function fetchRandom(): Promise<File> {
	const preset = RANDOM_PRESETS[Math.floor(Math.random() * RANDOM_PRESETS.length)];
	const seed = Math.floor(Math.random() * 1_000_000);
	const url = `https://picsum.photos/seed/${seed}/${preset.w}/${preset.h}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`picsum.photos returned ${res.status}`);
	const blob = await res.blob();
	const type = blob.type || "image/jpeg";
	const ext = type === "image/png" ? "png" : "jpg";
	return new File([blob], `random-${preset.label}-${seed}.${ext}`, { type });
}

export function Dropzone({ file, onFile, busy }: Props) {
	const [over, setOver] = useState(false);
	const [loadingRandom, setLoadingRandom] = useState(false);

	const onDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setOver(false);
			const f = e.dataTransfer.files[0];
			if (f && f.type.startsWith("image/")) onFile(f);
		},
		[onFile],
	);

	const onPick = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const f = e.target.files?.[0];
			if (f) onFile(f);
		},
		[onFile],
	);

	const onRandom = useCallback(async () => {
		if (loadingRandom || busy) return;
		setLoadingRandom(true);
		try {
			const f = await fetchRandom();
			onFile(f);
		} catch (err) {
			console.error(err);
		} finally {
			setLoadingRandom(false);
		}
	}, [loadingRandom, busy, onFile]);

	const previewUrl = file ? URL.createObjectURL(file) : null;

	return (
		<div className="dropzone-wrap">
			<div
				className={`dropzone ${over ? "over" : ""} ${busy ? "busy" : ""}`}
				onDragOver={(e) => {
					e.preventDefault();
					setOver(true);
				}}
				onDragLeave={() => setOver(false)}
				onDrop={onDrop}
			>
				{previewUrl ? (
					<>
						<img src={previewUrl} alt="source" className="preview" />
						<div className="file-info">
							<strong>{file!.name}</strong>
							<span>
								{file!.type} · {(file!.size / 1024).toFixed(1)} KB
							</span>
						</div>
					</>
				) : (
					<div className="placeholder">
						<div>Drop an image or click to choose a file.</div>
					</div>
				)}
				<input type="file" accept="image/*" onChange={onPick} className="file-input" />
			</div>
			<button
				type="button"
				className="random-btn"
				onClick={onRandom}
				disabled={loadingRandom || busy}
			>
				{loadingRandom ? "Fetching…" : "Use a random photo"}
			</button>
		</div>
	);
}
