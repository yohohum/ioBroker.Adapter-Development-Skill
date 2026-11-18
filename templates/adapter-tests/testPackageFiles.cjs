'use strict';

const path = require('node:path');
const { tests } = require('@iobroker/testing');

// Copy this file to test/package.test.js (or adjust adapterRoot for your project).
// tests.packageFiles validates package/io-package metadata and supported Admin JSON schemas.
const adapterRoot = path.resolve(__dirname, '..');
tests.packageFiles(adapterRoot);
