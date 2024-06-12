import { build } from "esbuild";
import { polyfillNode } from "esbuild-plugin-polyfill-node";

build({
    bundle: true,
	format: 'esm',
	charset: 'utf8',
	outfile: "dist/index.js",
	entryPoints: ["src/index.ts"],
	minify: true,
	sourcemap: true,
	logLevel: 'silent',
	resolveExtensions: ['.tsx', '.ts', '.jsx', '.mjs', '.js', '.json'],
	mainFields: ['worker', 'browser', 'module', 'jsnext', 'main'],
	conditions: ['worker', 'browser', 'import', 'production'],
    platform: 'neutral',
    plugins: [polyfillNode()],
    external: ['cloudflare:workers']
});