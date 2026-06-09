export { squash, preload as preloadSquash } from "./core/pipeline";
export { initializeSquash } from "./core/config";
export { ResponsiveImage } from "./components/responsive-image";
export { isOptimizedImage } from "./types/optimized-image";
export {
	InputSizeLimitError,
	InputPixelLimitError,
	UnsupportedAnimatedImageError,
	UnsupportedMimeTypeError,
	ImageDecodeError,
} from "./core/validation";

export type { SquashResult, SquashOptions } from "./types/squash";
export type { SquashConfig, SquashSizeKey, SquashVariantKey } from "./core/config";
export type { OptimizedImage, OptimizedVariant } from "./types/optimized-image";
export type { ResponsiveImageProps } from "./components/responsive-image";
