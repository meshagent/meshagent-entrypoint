const esbuild = require("esbuild");

// "build": "esbuild entrypoint.js
// --sourcemap
// --tree-shaking=true
// --bundle
// --outdir=dist
// --target=esnext
// --define:process={\"env\":\"production\",\"NODE_ENV\":\"production\"}
// --define:global=window --analyze --format=cjs",

const define = {
    "process.env": "production",
    "process.NODE_ENV": "production",
    "global": "window",
};

esbuild.build({
    entryPoints: ["index.ts"],
    bundle: true,
    minify: true,
    globalName: "meshagent",
    platform: "browser",
    define,
    outfile: "../meshagent-dart/js/entrypoint.txt",
}).catch((err) => console.error(err));

