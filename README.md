# browser-image-squash

> Client-side image optimization pipeline. One `File` in → four responsive sizes × two formats (AVIF + JPEG/PNG) out, encoded entirely in the browser with WASM codecs from [jSquash](https://github.com/jamsinclair/jSquash). No server round-trip to optimize, no upload coupling, no CDN lock-in.

```bash
npm install browser-image-squash
```

The jSquash WASM codecs (MozJPEG, libpng, OxiPNG, AVIF, Resize) are direct dependencies — they install automatically. `react` is an **optional** peer dependency, needed only for the `<ResponsiveImage>` component; the core works with no framework at all.

---

## What it does

Hand it a `File` / `Blob` / `ArrayBuffer`. It hands back **8 blobs** — four sizes, each as a modern AVIF and a universal JPEG/PNG fallback — plus the metadata you need to render them responsively and store them.

```ts
import { squash } from "browser-image-squash";

const result = await squash(file); // one call, no config
```

That single call returns everything below — **eight ready-to-store blobs** across four sizes (each as AVIF *plus* a JPEG/PNG fallback) and the metadata to render and persist them. For a 4000×3000 JPEG source:

```ts
{
  variants: {
    sm:  { raster: { blob: Blob /* ~18 KB */,  width: 640,  height: 480,  mimeType: "image/jpeg" },
           avif:   { blob: Blob /*  ~9 KB */,  width: 640,  height: 480,  mimeType: "image/avif" } },
    md:  { raster: { blob: Blob /* ~45 KB */,  width: 1024, height: 768,  mimeType: "image/jpeg" },
           avif:   { blob: Blob /* ~22 KB */,  width: 1024, height: 768,  mimeType: "image/avif" } },
    lg:  { raster: { blob: Blob /* ~84 KB */,  width: 1440, height: 1080, mimeType: "image/jpeg" },
           avif:   { blob: Blob /* ~41 KB */,  width: 1440, height: 1080, mimeType: "image/avif" } },
    org: { raster: { blob: Blob /* ~142 KB */, width: 1920, height: 1440, mimeType: "image/jpeg" },
           avif:   { blob: Blob /* ~71 KB */,  width: 1920, height: 1440, mimeType: "image/avif" } },
  },
  format: "jpeg",                            // picked once from the source (transparent → "png")
  alpha:  { nonOpaque: 0, total: 12000000, ratio: 0, isTransparent: false },
  source: { width: 4000, height: 3000, mimeType: "image/jpeg" },
}
```

What happens to those blobs is **your** decision — upload them, stuff them in IndexedDB, `URL.createObjectURL()` them, attach to `FormData`. The package is deliberately decoupled from storage. See [Backend example](#backend-example-upload-store-read-render) for the full save/read loop.

### Default settings

**Plug-and-play — sensible defaults, zero config.** `squash(file)` already does the right thing out of the box: it **resizes** into a responsive ladder, encodes **AVIF by default** (modern, tiny) *plus* a universal JPEG/PNG fallback, strips EXIF, and auto-picks PNG-vs-JPEG. No flags, no setup, no decisions to make.

Default sizes (longest edge):

| key   | longest edge |
| ----- | ------------ |
| `sm`  | ≤ 640px      |
| `md`  | ≤ 1024px     |
| `lg`  | ≤ 1440px     |
| `org` | ≤ 1920px     |

Quality defaults to **80** for raster and **`max(40, quality−25)`** for AVIF; `org` is near-lossless (raster 95 / AVIF 70). Everything here is overridable via [`initializeSquash`](#initializesquashoptions) — but you rarely need to touch it.

- **No upscaling.** A 500px source stays 500px across every variant.
- **AVIF is always on** — the modern-format payload; JPEG/PNG is the universal fallback. (WebP is decode-only: accepted as input, never produced.)
- **`org` is capped at 1920px by default**, not full resolution — keeps the heaviest encode fast everywhere, no setup. Want true originals? `sizes.org: false` (disable the cap) or `sizes.org: <number>`. If `org` re-encodes *larger* than the source, the original bytes are kept.

### Smart decisions made for you

- **PNG vs JPEG, automatically.** Alpha is measured on the source: >5% non-opaque pixels → PNG (lossy: RGB posterized to 2–32 levels + OxiPNG), otherwise → JPEG (MozJPEG). The 5% threshold ignores the stray transparent pixels macOS screenshots and PNG-32 exports carry.
- **EXIF orientation, always.** iPhone/camera JPEGs are physically rotated to the correct orientation, then *all* metadata (GPS, camera, author, thumbnail) is dropped from output. GPS coordinates never reach your storage.
- **Source-quality clamp.** Re-encoding an already-compressed JPEG never *raises* quality above the source — estimated from its quantization tables — so files don't grow.
- **Input guards before any WASM work** — file-size, pixel-count (image-bomb), animated-GIF, and mime-type gates fail fast with typed errors.

---

## Is it framework-agnostic?

**Yes — the core is pure browser, zero framework code.** `squash()` and every helper depend only on standard browser APIs (`Blob`, `ImageData`, `Worker`, `OffscreenCanvas`, `createImageBitmap`). Use it in **React, Vue, Svelte, SolidJS, Angular, vanilla JS, or a plain `<script type="module">`** — anywhere a browser runs.

- `react` is an **optional** peer dep. It is needed *only* if you import `<ResponsiveImage>`. Import `squash` and you never load React.
- Rendering without React is trivial — `OptimizedImage` is plain JSON, build a `<picture>` from it in any framework (example below).
- **Next.js?** Works fine — just call it client-side (`"use client"`), since it needs browser APIs. It is *not* a Next-only library.

### The one real requirement: a bundler that understands worker URLs

Encoding runs in a Web Worker pool. The worker is referenced the standard way:

```ts
new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
```

This resolves correctly in **Vite, webpack 5, Parcel, Rspack, Rollup** (with the worker plugin). The published package ships `worker.ts` next to the bundle for bundlers (like Parcel) that resolve the literal path.

- **No bundler / a bundler that can't follow the worker URL?** It still works — `squash()` detects the missing/failing worker environment (a capability probe + a try/catch) and **falls back to encoding on the main thread** via lazily-loaded WASM codecs. Slower and it blocks the UI thread, but functionally identical output.
- Because the shipped worker entry is `.ts`, a few exotic setups may need their worker loader to accept TypeScript. Vite/webpack-5/Parcel handle it out of the box.

---

## Bundle size & lazy loading

Adding this package barely touches your initial bundle. The WASM codecs — the heavy part — are **never** statically imported, so they never land in your main chunk. Each is a dynamic `import()`; your bundler code-splits them and loads **only the codecs a given image needs, only when you actually process one.**

| Stage | What loads | Weight |
| ----- | ---------- | ------ |
| `import { squash }` | core JS only (pipeline, config, guards) | **~9 KB** min+gzip, **zero WASM** |
| first `squash(file)` | the worker bundle (still no WASM) | ~40 KB, once |
| …mid-encode | only the WASM codecs that input requires | lazy, cached (see below) |

**Nothing heavy loads on import.** A bare `import` pulls ~9 KB of JS. `initializeSquash()` only sets config — it fetches nothing. No worker spins up and no `.wasm` is requested until the first `squash(file)` call. After that first run, every codec is cached for the rest of the session.

Per input, only what's needed is fetched:

- **JPEG source (opaque)** → MozJPEG (decode + encode) + Resize + AVIF encoder. libpng/OxiPNG never load.
- **PNG source (alpha)** → libpng (decode) + OxiPNG + Resize + AVIF encoder. MozJPEG never loads.

The **AVIF encoder dominates: ~3.5 MB raw / ~1.1 MB gzip.** That's the real, unavoidable price of encoding AVIF in a browser — it's the full libavif encoder compiled to WASM; there is no small build of it. It loads once, lazily, on the first encode and stays cached. Everything else (Resize, MozJPEG, libpng, OxiPNG) is ~8–100 KB gzip each. Because AVIF is always-on, that ~1.1 MB is the floor of a first real run — paid in the background while encoding, off the main thread, not at page load.

### Optional: `preloadSquash()` so the first run feels instant

By default nothing preloads, so a page that merely *imports* the library stays light — the cost is deferred until a user actually picks a file. If you'd rather pay it earlier (e.g. the moment an upload screen mounts, while the user is still choosing a file), call `preloadSquash()` once:

```ts
import { preloadSquash } from "browser-image-squash";

// On mount of your upload UI — spins the worker pool and fetches every WASM
// codec into cache now, so the first real squash() is fully hot.
preloadSquash();
```

One call, fire-and-forget (it returns a `Promise<void>` if you want to await readiness). It primes the worker pool and **all** codecs — we don't try to guess which formats you'll feed it. If workers aren't available it warms the main-thread codecs instead, matching `squash()`'s own fallback. Purely optional; skip it and everything self-loads on first use.

---

## Quick start

```ts
import { squash, initializeSquash } from "browser-image-squash";

// Optional: configure once, globally (singleton). Safe to skip — sane defaults.
initializeSquash({
  quality: 80,                          // 40–95, default 80
  sizes: { sm: 640, md: 1024, lg: 1440 }, // strictly increasing, ≥40px apart
});

const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
input.onchange = async () => {
  const file = input.files![0];
  const result = await squash(file, { onLog: (m) => console.debug(m) });

  // Preview the medium AVIF immediately:
  const url = URL.createObjectURL(result.variants.md.avif.blob);
  document.querySelector("img")!.src = url;
};
```

---

## Backend example: upload, store, read, render

End-to-end loop with a Node/Express backend and any blob storage (local disk, S3, R2, UploadThing — anything that returns a URL). The persisted shape is `OptimizedImage` — **one JSON value per image**, 8 URLs + per-variant dimensions, no convention magic.

### The persisted shape

```ts
import type { OptimizedImage } from "browser-image-squash";

// You don't write this by hand — `toOptimizedImage()` (step 1) builds it and sets
// the schema `v` for you. This is simply what lands in your DB as one JSON column
// per image: 8 URLs + per-variant dimensions (the w/h kill layout shift / CLS).
const cover: OptimizedImage = {
  v: 1,
  format: "jpeg",
  sm:  { w: 640,  h: 427,  url: "https://cdn.example.com/img/abc/sm.raster",  avifUrl: "https://cdn.example.com/img/abc/sm.avif"  },
  md:  { w: 1024, h: 683,  url: "https://cdn.example.com/img/abc/md.raster",  avifUrl: "https://cdn.example.com/img/abc/md.avif"  },
  lg:  { w: 1440, h: 960,  url: "https://cdn.example.com/img/abc/lg.raster",  avifUrl: "https://cdn.example.com/img/abc/lg.avif"  },
  org: { w: 1920, h: 1280, url: "https://cdn.example.com/img/abc/org.raster", avifUrl: "https://cdn.example.com/img/abc/org.avif" },
};
```

### 1. Client — optimize and upload all 8 blobs

```ts
import { squash, variantBlobs, toOptimizedImage, type OptimizedImage } from "browser-image-squash";

export async function optimizeAndUpload(file: File): Promise<OptimizedImage> {
  const result = await squash(file); // 8 blobs, in memory

  // Upload all 8 blobs, each keyed "<variant>.<kind>" — no hardcoded list.
  const form = new FormData();
  for (const { key, kind, blob } of variantBlobs(result)) {
    form.append(`${key}.${kind}`, blob);
  }
  const url: Record<string, string> = await fetch("/api/images", {
    method: "POST",
    body: form,
  }).then((r) => r.json()); // { "sm.raster": "https://…", "sm.avif": "https://…", … }

  // One call: result + returned URLs → the storable JSON (per-variant dims included).
  return toOptimizedImage(result, (key, kind) => url[`${key}.${kind}`]);
}
```

> Uploading many images at once (e.g. 20 photos)? Cap how many `optimizeAndUpload` calls run in parallel so you don't flood the network — chunk your `Promise.all`, or use a tiny limiter like [`p-limit`](https://github.com/sindresorhus/p-limit):
> ```ts
> import pLimit from "p-limit";
> const limit = pLimit(4); // up to 4 images in flight
> await Promise.all(files.map((f) => limit(() => optimizeAndUpload(f))));
> ```

### 2. Server — receive blobs, store, persist the JSON

```ts
// Express + multer; swap the storage line for S3/R2/UploadThing.
import express from "express";
import multer from "multer";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/images — receives the 8 blobs, returns { field: url }.
app.post("/api/images", upload.any(), async (req, res) => {
  const imageId = randomUUID();
  const files = req.files as Express.Multer.File[];

  const stored: Record<string, string> = {};
  for (const f of files) {
    // f.fieldname is "sm.raster" / "sm.avif" / … — keep it as the object key.
    const objectPath = `images/${imageId}/${f.fieldname}`;
    await writeFile(`./public/${objectPath}`, f.buffer); // or s3.putObject(...)
    stored[f.fieldname] = `${process.env.CDN_BASE}/${objectPath}`;
  }
  res.json(stored);
});

// The client turns `stored` into an OptimizedImage and PUTs it onto the parent
// record (post, product, profile). One JSON column:
//   await db.post.update({ where: { id }, data: { cover: optimizedImage } });
```

The `POST /api/images` response — the field→URL map the client passes straight to `toOptimizedImage`:

```jsonc
{
  "sm.raster":  "https://cdn.example.com/img/abc/sm.raster",
  "sm.avif":    "https://cdn.example.com/img/abc/sm.avif",
  "md.raster":  "https://cdn.example.com/img/abc/md.raster",
  "md.avif":    "https://cdn.example.com/img/abc/md.avif",
  "lg.raster":  "https://cdn.example.com/img/abc/lg.raster",
  "lg.avif":    "https://cdn.example.com/img/abc/lg.avif",
  "org.raster": "https://cdn.example.com/img/abc/org.raster",
  "org.avif":   "https://cdn.example.com/img/abc/org.avif"
}
```

If you prefer the server to own the canonical shape, build the `OptimizedImage` server-side instead and return it directly — the client `optimizeAndUpload` then just forwards `result.format` and per-variant dimensions in the multipart fields.

### 3. Server — read it back

```ts
// GET /api/posts/:id → returns the row with its OptimizedImage JSON column.
app.get("/api/posts/:id", async (req, res) => {
  const post = await db.post.findUnique({ where: { id: req.params.id } });
  res.json(post); // post.cover is the OptimizedImage, ready for <ResponsiveImage>
});
```

Defensive read for mixed legacy data (some rows still hold a plain URL string):

```ts
import { isOptimizedImage } from "browser-image-squash";

const img = isOptimizedImage(post.cover) ? post.cover : { fallbackUrl: post.cover };
```

### 4. Render

**React** — drop-in `<picture>` with AVIF + responsive `srcset`, zero CLS:

```tsx
import { ResponsiveImage } from "browser-image-squash";

// Minimal — just the stored object + alt. Everything else has sane defaults.
<ResponsiveImage img={post.cover} alt="Cover" />;

// Optional props (defaults shown); any other <img> attribute is forwarded too:
<ResponsiveImage
  img={post.cover}                          // OptimizedImage (or a plain URL fallback)
  alt="Cover"
  sizes="(min-width: 1024px) 50vw, 100vw"   // default: "100vw"
  loading="eager"                           // default: "lazy"; eager for above-the-fold
/>;
```

The browser picks AVIF when supported, falls back to JPEG/PNG otherwise, and `srcset`/`sizes` choose the smallest variant that fits the slot — no JS at runtime. `width`/`height` come from the `org` variant so layout space is reserved before bytes land.

**Any framework / vanilla** — `OptimizedImage` is just JSON; build the `<picture>` yourself:

```ts
function pictureHtml(img, alt, sizes = "100vw") {
  const order = ["sm", "md", "lg", "org"];
  const set = (pick) => order.map((k) => `${pick(img[k])} ${img[k].w}w`).join(", ");
  const rasterType = img.format === "png" ? "image/png" : "image/jpeg";
  return `
    <picture>
      <source type="image/avif" srcset="${set((v) => v.avifUrl)}" sizes="${sizes}">
      <source type="${rasterType}" srcset="${set((v) => v.url)}" sizes="${sizes}">
      <img src="${img.org.url}" width="${img.org.w}" height="${img.org.h}"
           alt="${alt}" loading="lazy" decoding="async">
    </picture>`;
}
```

---

## API reference

### `squash(input, options?) → Promise<SquashResult>`

```ts
function squash(
  input: Blob | ArrayBuffer | File,
  options?: {
    onLog?: (msg: string) => void;   // progress / diagnostics, default no-op
    limits?: InputGateOptions;       // per-call override of global input guards
    signal?: AbortSignal;            // cancel an in-flight run (see below)
  },
): Promise<SquashResult>;
```

`SquashResult`:

```ts
interface SquashResult {
  variants: Record<"sm" | "md" | "lg" | "org", {
    raster: { blob: Blob; width: number; height: number; mimeType: "image/jpeg" | "image/png" };
    avif:   { blob: Blob; width: number; height: number; mimeType: "image/avif" };
  }>;
  format: "jpeg" | "png";
  alpha: { nonOpaque: number; total: number; ratio: number; isTransparent: boolean };
  source: { width: number; height: number; mimeType: string };
}
```

### `initializeSquash(options?)`

Sets the global singleton config. Called implicitly with defaults on first `squash()` if you skip it.

```ts
initializeSquash({
  quality: 80,                              // [40, 95], default 80
  sizes: { sm: 640, md: 1024, lg: 1440 },   // strictly increasing, ≥40px gaps, [80, 8000]px
  avifSpeed: 6,                             // libavif speed [0, 10], default 6 (lower = smaller files, slower encode)
  // sizes.org?: number | false             // largest variant, default 1920; a number = custom cap; false = no cap (full resolution)
  limits: { maxFileSizeMB: 50, maxPixelsMP: 100 },
  removeMetadata: true,                     // visibility flag; strip is always on
});
```

Validation throws `RangeError` for nonsensical config (duplicate/decreasing sizes, out-of-range quality, etc.).

### Input limits & typed errors

Guards run *before* decoding, so bad inputs fail cheaply:

| Default              | Stops                       | Disable / override                          |
| -------------------- | --------------------------- | ------------------------------------------- |
| `maxFileSizeMB: 50`  | encoder OOM on huge files   | `limits: { maxFileSizeMB: 200 }` or `false` |
| `maxPixelsMP: 100`   | image bombs                 | `limits: { maxPixelsMP: 200 }` or `false`   |
| animated-GIF reject  | unsupported animation       | always on (static GIF passes through)       |
| mime allow-list      | SVG/PDF/etc.                | `limits: { allowedMimeTypes: new Set([...]) }` |

```ts
import { InputSizeLimitError, UnsupportedAnimatedImageError } from "browser-image-squash";

try {
  await squash(file);
} catch (err) {
  if (err instanceof UnsupportedAnimatedImageError) toast("Animated GIFs aren't supported");
  else if (err instanceof InputSizeLimitError) toast(err.message);
  else throw err;
}
```

`ImageDecodeError` is thrown when a format passes the gate but the browser
can't decode it (most often **HEIC/HEIF outside Safari** — iPhone's default
format). Branch on it to prompt for a JPEG/PNG instead. Also exported:
`InputPixelLimitError` and `UnsupportedMimeTypeError`.

### Cancellation

Pass an `AbortSignal` to drop a run you no longer need — e.g. the user swapped
files before the first finished. `squash()` rejects with an `AbortError` at the
next stage boundary, so a stale result can't overwrite a newer one:

```ts
const ac = new AbortController();
input.onchange = () => { ac.abort(); ac = new AbortController(); start(file, ac.signal); };

try {
  const result = await squash(file, { signal: ac.signal });
} catch (err) {
  if (err.name === "AbortError") return; // superseded — ignore
  throw err;
}
```

In-flight WASM in a worker runs to completion (it can't be interrupted mid-call)
but its output is discarded.

---

## Performance notes

- **All pixel work runs off the main thread.** A single worker "prep" pass decodes, applies EXIF rotation, analyzes alpha, and downscales to every size; the four sized bitmaps are *transferred* back (zero-copy), so the UI thread never scans or rotates full-resolution pixels.
- **Encodes fan out across the pool.** The 8 encodes (4 sizes × raster/avif) each receive an already-sized bitmap, so the source is resized once per size — not re-resized per encode — and only the small variants are cloned to workers, not the full-res source 8×.
- The shared pool sizes to `clamp(navigator.hardwareConcurrency, 2, 8)`; each worker lazy-loads only the WASM codecs it touches. First `squash()` pays a one-time WASM load (~1–2s); later calls reuse cached modules.
- AVIF is the slowest leg. `avifSpeed` (default **6**, libavif's own default) trades file size against encode time at the *same* visual quality (quality is set by `quality`, not speed): lower → smaller files, slower; higher → faster, slightly larger.

### Two levels of parallelism

1. **Across CPU cores, always on — no setup.** The variant encodes run in parallel across a Web Worker pool sized to `navigator.hardwareConcurrency`. On an 8-core machine the 8 encodes already use all 8 cores. This needs **nothing** — no headers, no config.
2. **Within a single encode — optional.** jSquash also ships *multi-threaded* AVIF/OxiPNG encoders that split one encode across cores. The browser only grants the required `SharedArrayBuffer` to **cross-origin isolated** pages, so this engages **only** if your server sends `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`). When absent, it transparently falls back to single-threaded — nothing breaks. jSquash auto-selects.

**You almost never need level 2.** Because `org` is capped at 1920px by default, there's no giant full-res AVIF to accelerate — level 1 already covers it. Reach for the isolation headers only if you raise `sizes.org` to large originals *and* you control the server. Otherwise leave them alone; this stays plug-and-play.

---

## Demo

```bash
npm run demo
```

A Vite playground: drop an image, tweak `quality` and per-variant `maxEdge`, and inspect every variant's byte size, dimensions, and a before/after compare slider.

## Issues & feedback

Found a bug or have a feature idea? [Open an issue on GitHub](https://github.com/Dawidw5219/browser-image-squash/issues) — bug reports and feature requests are both welcome.

## License

MIT
