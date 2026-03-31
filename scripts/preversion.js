#!/usr/bin/env node
// Keeps src/manifest.json version in sync with package.json during `npm version`.
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync("src/manifest.json", "utf8"));
manifest.version = process.env.npm_new_version;
fs.writeFileSync("src/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`src/manifest.json version → ${manifest.version}`);
