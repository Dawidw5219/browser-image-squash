export { squash, preload as preloadSquash } from "./core/pipeline";
export {
	AVIF_FLOOR,
	AVIF_OFFSET,
	AVIF_SPEED_DEFAULT,
	AVIF_SPEED_MAX,
	AVIF_SPEED_MIN,
	DEFAULT_ORG_SIZE,
	DEFAULT_SIZES,
	QUALITY_DEFAULT,
	QUALITY_MAX,
	QUALITY_MIN,
	SIZE_MAX_PX,
	SIZE_MIN_GAP_PX,
	SIZE_MIN_PX,
	initializeSquash,
} from "./core/config";
export { ResponsiveImage } from "./components/responsive-image";
export {
	isOptimizedImage,
	toOptimizedImage,
	variantBlobs,
} from "./types/optimized-image";
export {
	InputSizeLimitError,
	InputPixelLimitError,
	UnsupportedAnimatedImageError,
	UnsupportedMimeTypeError,
	ImageDecodeError,
} from "./core/validation";

export type { SquashResult, SquashOptions, VariantResult } from "./types/squash";
export type { SquashConfig, SquashSizeKey, SquashVariantKey } from "./core/config";
export type {
	OptimizedImage,
	OptimizedVariant,
	VariantBlobEntry,
} from "./types/optimized-image";
export type { ResponsiveImageProps } from "./components/responsive-image";
