import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteStaticCopy } from "vite-plugin-static-copy";

// A relative base makes the build work at the root, under a GitHub project
// page's /<repo>/ prefix, or under a custom domain, with no rebuild. All URL
// resolution funnels through siteBase() in src/lib/models.ts.
export default defineConfig({
  base: "./",
  plugins: [
    svelte(),
    viteStaticCopy({
      targets: [
        // ORT constructs these filenames internally, so Vite cannot resolve
        // them for us; they are copied verbatim and located via ortBase().
        { src: "node_modules/onnxruntime-web/dist/*.wasm", dest: "ort" },
        { src: "node_modules/onnxruntime-web/dist/*.mjs", dest: "ort" },
        // Whole model directories, so meta.json ships next to its model and
        // the deployed site is self-describing. Only the .onnx is fetched at
        // runtime; the metadata is inlined into the bundle at build time.
        { src: "models/*", dest: "models" },
      ],
    }),
  ],
  worker: { format: "es" },
});
