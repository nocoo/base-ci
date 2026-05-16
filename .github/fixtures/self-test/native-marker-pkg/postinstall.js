// Mirrors what a native dep's postinstall does: write an env-var marker
// (so the workflow can assert postinstall ran) AND drop a "binding" flag
// inside the package so `require('self-test-native-marker')` can verify it
// loaded successfully. Without this flag the require throws — exactly the
// failure mode `better-sqlite3` would exhibit when its postinstall is
// suppressed.
const fs = require('fs');
const path = require('path');

const envMarker = process.env.NATIVE_MARKER_FILE || '/tmp/self-test-native-marker';
fs.writeFileSync(envMarker, 'ran');

const bindingFlag = path.join(__dirname, 'binding.flag');
fs.writeFileSync(bindingFlag, 'built');
