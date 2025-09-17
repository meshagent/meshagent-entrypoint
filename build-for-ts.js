const esbuild = require("esbuild");

// "build": "esbuild entrypoint.js
// --sourcemap
// --tree-shaking=true
// --bundle
// --outdir=dist
// --target=esnext
// --define:process={\"env\":\"production\",\"NODE_ENV\":\"production\"}
// --define:global=window --analyze --format=cjs",

// const define = {
//     "process.env": "production",
//     "process.NODE_ENV": "production",
//     "global": "process",
// };

esbuild.build({
    entryPoints: ["index.ts"],
    bundle: true,
    minify: false,
    format: "esm",
    outfile: "../meshagent-ts/src/entrypoint.js",
}).catch((err) => console.error(err));

