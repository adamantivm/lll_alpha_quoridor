import { afterEach, describe, expect, it, vi } from "vitest";
import { checkWebGpu, detectWebGpu } from "./webgpu";

describe("detectWebGpu", () => {
  it("reports no-api when the browser has no navigator.gpu", async () => {
    expect(await detectWebGpu(undefined)).toEqual({ ok: false, reason: "no-api" });
  });

  it("reports ok when an adapter is returned", async () => {
    const gpu = { requestAdapter: async () => ({ name: "fake-adapter" }) };
    expect(await detectWebGpu(gpu)).toEqual({ ok: true });
  });

  // The API can exist while the GPU is blocklisted, or under a headless/VM
  // session with no usable adapter. A null adapter is the documented way
  // requestAdapter says "no", so presence of the API is not enough.
  it("reports no-adapter when requestAdapter resolves null", async () => {
    const gpu = { requestAdapter: async () => null };
    expect(await detectWebGpu(gpu)).toEqual({ ok: false, reason: "no-adapter" });
  });

  it("reports error, with the message, when requestAdapter throws", async () => {
    const gpu = { requestAdapter: async () => { throw new Error("boom"); } };
    const status = await detectWebGpu(gpu);
    expect(status.ok).toBe(false);
    if (status.ok) throw new Error("unreachable");
    expect(status.reason).toBe("error");
    expect(status.detail).toContain("boom");
  });

  it("does not reject when requestAdapter throws", async () => {
    const gpu = { requestAdapter: async () => { throw new Error("boom"); } };
    await expect(detectWebGpu(gpu)).resolves.toBeDefined();
  });
});

describe("checkWebGpu", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reads navigator.gpu and reports ok when an adapter is returned", async () => {
    const gpu = { requestAdapter: async () => ({ name: "fake-adapter" }) };
    vi.stubGlobal("navigator", { gpu });
    await expect(checkWebGpu()).resolves.toEqual({ ok: true });
  });

  it("reports no-api when navigator has no gpu", async () => {
    vi.stubGlobal("navigator", {});
    await expect(checkWebGpu()).resolves.toEqual({ ok: false, reason: "no-api" });
  });

  it("resolves to the timeout status when requestAdapter never settles", async () => {
    vi.useFakeTimers();
    const gpu = { requestAdapter: () => new Promise(() => {}) };
    vi.stubGlobal("navigator", { gpu });

    const result = checkWebGpu(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    const status = await result;

    expect(status.ok).toBe(false);
    if (status.ok) throw new Error("unreachable");
    expect(status.reason).toBe("error");
    expect(status.detail).toContain("timed out");
  });
});
