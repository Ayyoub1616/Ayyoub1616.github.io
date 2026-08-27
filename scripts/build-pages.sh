#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"
pnpm exec vite build --config vite.pages.config.ts
cp pages-src/manifest.webmanifest .pages-dist/manifest.webmanifest
cp pages-src/sw.js .pages-dist/sw.js
touch .pages-dist/.nojekyll
