import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteStaticCopy } from "vite-plugin-static-copy";

// A relative base makes the build work at the root, under a GitHub project
// page's /<repo>/ prefix, or under a custom domain, with no rebuild. All URL
// resolution funnels through siteBase() in src/lib/models.ts.
export default defineConfig({
  base: "./",
  // Which build a recorded game came from. GITHUB_SHA is set by the Pages
  // workflow; local builds report "dev" so their games are easy to exclude.
  define: { __APP_VERSION__: JSON.stringify(process.env.GITHUB_SHA ?? "dev") },
  // Two pages: the game, and the stats/replay view of the games D1 has
  // collected. Both flat at the site root, so a relative base resolves assets
  // from the same ./assets/ for either document.
  build: { rollupOptions: { input: { main: "index.html", stats: "stats.html" } } },
  plugins: [
    svelte(),
    viteStaticCopy({
      targets: [
        // ORT constructs these filenames internally, so Vite cannot resolve
        // them for us; they are copied verbatim and located via ortBase().
        // The worker's entry point, onnxruntime-web/webgpu, requests
        // ort-wasm-simd-threaded.asyncify.{wasm,mjs} beneath `wasmPaths`.
        // The entry point and `wasmPaths` decide the filenames -- the
        // executionProviders list does NOT participate in that choice -- so
        // this glob is correct whether or not the wasm-CPU fallback is
        // enabled. Do not widen it just because `executionProviders` grows;
        // the jsep/jspi/base wasm builds and the webgl/node/all .mjs
        // variants are unreachable regardless. Shipping all of them cost
        // 93MB, uploaded on every deploy.
        { src: "node_modules/onnxruntime-web/dist/*asyncify*", dest: "ort" },
        // Whole model directories, so meta.json ships next to its model and
        // the deployed site is self-describing. Only the .onnx is fetched at
        // runtime; the metadata is inlined into the bundle at build time.
        { src: "models/*", dest: "models" },
      ],
    }),
  ],
  worker: { format: "es" },
});
