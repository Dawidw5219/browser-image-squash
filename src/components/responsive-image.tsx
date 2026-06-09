import type { CSSProperties, ImgHTMLAttributes, ReactElement } from "react";
import {
	isOptimizedImage,
	type OptimizedImage,
	type OptimizedVariant,
} from "../types/optimized-image";

/**
 * Render an image as a responsive `<picture>` element.
 *
 * Pass an `OptimizedImage` for the full treatment: the browser picks AVIF when
 * supported, falls back to JPEG/PNG otherwise, and `srcset` + `sizes` let it
 * choose the smallest variant that fits the layout slot — no JS, no third-party
 * CDN, just the spec. The `<img>` `width`/`height` come from the `org` variant
 * so layout space is reserved before bytes land (zero CLS).
 *
 *   <ResponsiveImage img={uploaded} alt="Clinic exterior" sizes="(min-width: 1024px) 50vw, 100vw" />
 *
 * A plain URL string is also accepted as a fallback — it renders a single
 * `<img src>` and logs a dev warning, because it skips optimization entirely.
 */
export interface ResponsiveImageProps
	extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet"> {
	/** An `OptimizedImage` (preferred) or a plain URL string (fallback). */
	img: OptimizedImage | string;
	/** Defaults to `100vw`. Override to match your layout slot. */
	sizes?: string;
	/** Defaults to `"lazy"`. Use `"eager"` for above-the-fold hero images. */
	loading?: "lazy" | "eager";
	className?: string;
	style?: CSSProperties;
}

const VARIANT_KEYS = ["sm", "md", "lg", "org"] as const;

/** Warn at most once per offending value so re-renders don't spam the console. */
const warnedKeys = new Set<string>();

function warnNotOptimized(value: unknown): void {
	const key = typeof value === "string" ? value : JSON.stringify(value);
	if (warnedKeys.has(key)) return;
	warnedKeys.add(key);
	console.warn(
		"[browser-image-squash] <ResponsiveImage> received a plain URL, not an OptimizedImage — " +
			"rendering a raw <img>, so AVIF + responsive variants are skipped. " +
			"Run the source through squash() and persist the OptimizedImage to get proper optimization.",
		value,
	);
}

export function ResponsiveImage({
	img,
	alt,
	sizes = "100vw",
	loading = "lazy",
	className,
	style,
	...imgProps
}: ResponsiveImageProps): ReactElement {
	// Fallback: a plain URL string (or anything that isn't a valid OptimizedImage).
	if (!isOptimizedImage(img)) {
		warnNotOptimized(img);
		return (
			<img
				{...imgProps}
				src={typeof img === "string" ? img : ""}
				alt={alt ?? ""}
				loading={loading}
				decoding="async"
				className={className}
				style={style}
			/>
		);
	}

	const rasterMime = img.format === "jpeg" ? "image/jpeg" : "image/png";
	const variants = VARIANT_KEYS.map((k) => [k, img[k]] as const);

	const avifSrcset = buildSrcset(
		variants.filter(([, v]) => Boolean(v.avifUrl)),
		(v) => v.avifUrl as string,
	);
	const rasterSrcset = buildSrcset(variants, (v) => v.url);

	return (
		// `display: contents` makes the <picture> wrapper layout-transparent, so
		// the <img> is sized/positioned by the PARENT (the `className`/`style`
		// here apply to the <img>). Without it, the inline <picture> has no box
		// and `h-full`/`object-cover` on the image collapse.
		<picture style={{ display: "contents" }}>
			{avifSrcset && (
				<source type="image/avif" srcSet={avifSrcset} sizes={sizes} />
			)}
			<source type={rasterMime} srcSet={rasterSrcset} sizes={sizes} />
			{/* biome-ignore lint/a11y/useAltText: alt comes through props or imgProps */}
			<img
				{...imgProps}
				src={img.org.url}
				width={img.org.w}
				height={img.org.h}
				alt={alt ?? ""}
				loading={loading}
				decoding="async"
				className={className}
				style={style}
			/>
		</picture>
	);
}

function buildSrcset(
	entries: readonly (readonly [string, OptimizedVariant])[],
	pickUrl: (v: OptimizedVariant) => string,
): string {
	return entries.map(([, v]) => `${pickUrl(v)} ${v.w}w`).join(", ");
}
