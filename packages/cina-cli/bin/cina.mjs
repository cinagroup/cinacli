#!/usr/bin/env node
/** @type {typeof import("../src/index.mjs")} */
const { main } = await import(
	new URL("../dist/index.mjs", import.meta.url).href
);

process.exitCode = await main(process.argv.slice(2));
