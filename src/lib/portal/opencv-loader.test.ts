import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// The real package is ~13 MB of WASM and will not initialise under the test
// DOM anyway. Both dependencies are stubbed with a module that yields no
// usable `cv`, which is precisely the shape of the case that matters: an old
// device, a blocked WASM MIME type, a dead network. What is under test is the
// LOADER's contract — idempotence, status reporting, and above all that a
// failure resolves null instead of throwing, because the scanner is supposed
// to carry on with the built-in detector.
vi.mock("@techstark/opencv-js", () => ({ default: {} }));
vi.mock("jscanify/client", () => ({ default: class {} }));

// The single most expensive bug in this feature, pinned at the source level
// because NOTHING else can see it: a direct `await import("@techstark/
// opencv-js")` throws "Promise.prototype.then called on incompatible
// receiver [object Module]" inside import() itself — the package sets
// module.exports to a Promise, so interop puts `then` on the module
// namespace and the namespace gets adopted as a thenable.
//
// It typechecks, lints, builds and passes every unit test, because the loader
// catches it and falls back to the built-in detector. The only symptom in
// production is that the OpenCV upgrade silently never arrives. It was caught
// by asking a real browser whether `window.cv` existed. A future refactor
// that "simplifies away" the ./opencv-module indirection would reintroduce it
// just as invisibly — hence this test.
describe("the OpenCV import indirection", () => {
  // import.meta.url is an http:// URL under the happy-dom environment, so the
  // sources are read from the repo root instead.
  async function readSource(name: string): Promise<string> {
    const [{ readFileSync }, { join }] = await Promise.all([
      import("node:fs"),
      import("node:path"),
    ]);
    return readFileSync(join(process.cwd(), "src/lib/portal", name), "utf8");
  }

  it("reaches OpenCV through ./opencv-module and never imports the package directly", async () => {
    const src = await readSource("opencv-loader.ts");
    expect(src).toContain('import("./opencv-module")');
    expect(src).not.toMatch(/import\(\s*["']@techstark\/opencv-js["']\s*\)/);
  });

  it("keeps the static import inside opencv-module, which is what makes it safe", async () => {
    const src = await readSource("opencv-module.ts");
    // Comments stripped first: that file DOCUMENTS the forbidden call, and the
    // prose explaining the trap must not read as the trap itself.
    const code = src.replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/^import cvModule from "@techstark\/opencv-js";$/m);
    expect(code).not.toContain('import("@techstark/opencv-js")');
  });
});

describe("loadScanEngine", () => {
  let mod: typeof import("./opencv-loader");

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("./opencv-loader");
    mod.__resetScanEngineForTests();
  });

  afterEach(() => {
    mod.__resetScanEngineForTests();
  });

  it("starts idle with no engine", () => {
    expect(mod.getScanEngineStatus()).toBe("idle");
    expect(mod.currentScanEngine()).toBeNull();
  });

  it("resolves null and reports failed when the engine cannot load — scanning must fall back, never break", async () => {
    // Under the test DOM the opencv/jscanify imports do not produce a usable
    // runtime, which is the same shape as a blocked-WASM device.
    const engine = await mod.loadScanEngine();
    expect(engine).toBeNull();
    expect(mod.getScanEngineStatus()).toBe("failed");
    expect(mod.currentScanEngine()).toBeNull();
  });

  it("is idempotent — a second call reuses the first promise rather than downloading again", async () => {
    const a = mod.loadScanEngine();
    const b = mod.loadScanEngine();
    expect(a).toBe(b);
    await a;
  });

  it("notifies subscribers on every status change and stops after unsubscribe", async () => {
    const seen: string[] = [];
    const off = mod.subscribeScanEngine(() =>
      seen.push(mod.getScanEngineStatus()),
    );
    await mod.loadScanEngine();
    expect(seen).toContain("loading");
    expect(seen.at(-1)).toBe("failed");

    off();
    const before = seen.length;
    mod.__resetScanEngineForTests();
    await mod.loadScanEngine();
    expect(seen.length).toBe(before);
  });
});
