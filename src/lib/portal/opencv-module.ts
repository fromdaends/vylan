// Isolation layer between the bundler and OpenCV.js. Exists for one reason,
// and it is not stylistic.
//
// `@techstark/opencv-js` sets `module.exports` to a PROMISE (an Emscripten
// MODULARIZE build). Interop turns each own property of a CommonJS exports
// object into a named ESM export — including, here, `then`. That makes the
// module NAMESPACE itself thenable, and `await import("@techstark/opencv-js")`
// then tries to adopt the namespace as a thenable and calls
// `Promise.prototype.then` with a Module namespace as its receiver:
//
//     TypeError: Method Promise.prototype.then called on incompatible
//                receiver [object Module]
//
// It fails INSIDE import(), before a single line of our code runs, so no
// amount of defensive unwrapping at the call site can rescue it. (It also
// fails silently in the shipped product: the loader catches everything and
// falls back, so the scanner keeps working on the built-in detector and the
// OpenCV upgrade just never arrives. It was found by asking a real browser
// whether `window.cv` existed, not by reading a green build.)
//
// A STATIC import has no such promise-resolution step, so it is immune. This
// module therefore imports OpenCV statically and re-exports it behind a
// function — leaving a namespace with one plain function on it and nothing
// called `then`. The dynamic import in opencv-loader.ts points HERE, so the
// code-splitting is unchanged: OpenCV still lands in its own lazy chunk and
// still never touches the portal bundle.

import cvModule from "@techstark/opencv-js";

/**
 * The raw OpenCV export — a Promise of the runtime, or the runtime itself,
 * depending on the build. opencv-loader.ts normalises the shapes.
 */
export function getCvModule(): unknown {
  return cvModule;
}
