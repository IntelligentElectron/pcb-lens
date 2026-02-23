/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- Bun-only: { type: "file" } embeds the WASM in compiled binaries
import wasmPath from "@resvg/resvg-wasm/index_bg.wasm" with { type: "file" };
export default wasmPath;
