#!/bin/bash
export TMPDIR=/tmp
export PLAYWRIGHT_TRANSFORM_CACHE_DIR="$HOME/.cache/playwright-transform-cache"
cd /Volumes/WorkSSD/Projects/sntclub-autotests
npx playwright test tests/voting-release.spec.js --headed
