/**
 * Whether this browser can actually run WebGPU inference. Advisory only: the
 * worker's `executionProviders` is `["webgpu", "wasm"]`, and onnxruntime
 * falls back to its wasm-CPU backend on its own without being asked, so this
 * result decides only whether to warn the user that the AI will be slower.
 */

export type WebGpuStatus =
  | { ok: true }
  | { ok: false; reason: "no-api" | "no-adapter" | "error"; detail?: string };

/**
 * The one method we need from `navigator.gpu`. Declared structurally because
 * `@webgpu/types` is not installed and tsconfig admits only `svelte` and
 * `vite/client` — a whole type package for one method would not pay for itself.
 */
export interface GpuLike {
  requestAdapter(): Promise<unknown>;
}

/** Pure: takes the GPU object rather than reading a global, so it is testable. */
export async function detectWebGpu(gpu: GpuLike | undefined): Promise<WebGpuStatus> {
  if (!gpu) return { ok: false, reason: "no-api" };
  try {
    // The API can be present while no adapter is available -- a blocklisted
    // driver, a headless session, a VM. Only an adapter proves usability.
    const adapter = await gpu.requestAdapter();
    return adapter ? { ok: true } : { ok: false, reason: "no-adapter" };
  } catch (e) {
    return { ok: false, reason: "error", detail: String(e) };
  }
}

/**
 * Reads `navigator.gpu` and races detection against a timeout: a wedged GPU
 * process (a known failure mode on some Linux/Chrome and Safari setups) can
 * leave `requestAdapter()` never settling, and this is the one path that
 * runs in production, so it must not be able to hang the app forever.
 */
export function checkWebGpu(timeoutMs = 10_000): Promise<WebGpuStatus> {
  const gpu = (globalThis.navigator as (Navigator & { gpu?: GpuLike }) | undefined)?.gpu;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<WebGpuStatus>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, reason: "error", detail: "WebGPU adapter request timed out" }),
      timeoutMs,
    );
  });
  return Promise.race([detectWebGpu(gpu), timeout]).finally(() => clearTimeout(timer));
}
