// Hand-written types for jscanify's browser build (the package ships none).
// The library reads the global `cv` (OpenCV.js) at CALL time, not at import
// time — see src/lib/portal/opencv-loader.ts, which guarantees the global is
// set before any of these methods run.
declare module "jscanify/client" {
  export type JscanifyPoint = { x: number; y: number };

  export type JscanifyCornerPoints = {
    topLeftCorner: JscanifyPoint | null | undefined;
    topRightCorner: JscanifyPoint | null | undefined;
    bottomLeftCorner: JscanifyPoint | null | undefined;
    bottomRightCorner: JscanifyPoint | null | undefined;
  };

  export default class Jscanify {
    /** Returns the largest contour (a cv.Mat the CALLER must .delete()) or null. */
    findPaperContour(mat: unknown): { delete(): void } | null;
    getCornerPoints(contour: unknown, mat?: unknown): JscanifyCornerPoints;
    /**
     * Perspective-corrects the paper inside `image` (canvas/img element) to a
     * resultWidth x resultHeight canvas. Returns null when no paper found and
     * no corner points were supplied.
     */
    extractPaper(
      image: unknown,
      resultWidth: number,
      resultHeight: number,
      cornerPoints?: JscanifyCornerPoints,
    ): HTMLCanvasElement | null;
    highlightPaper(
      image: unknown,
      options?: { color?: string; thickness?: number },
    ): HTMLCanvasElement;
  }
}
