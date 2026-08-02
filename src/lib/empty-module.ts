// Stand-in for a Node built-in that a browser bundle must never actually
// reach. See the `turbopack.resolveAlias` block in next.config.ts: OpenCV.js
// (the portal scanner's detection engine) is one Emscripten file serving both
// Node and the browser, and its dead `require("fs")` branch still has to
// RESOLVE for the client build to succeed. Nothing calls into this.
const empty = {};
export default empty;
