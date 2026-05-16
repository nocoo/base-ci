// Stand-in for a native dep's main entry. Throws if the postinstall flag
// is missing — the way `require('better-sqlite3')` throws when its
// prebuilt binding never got fetched.
const fs = require('fs');
const path = require('path');

const flag = path.join(__dirname, 'binding.flag');
if (!fs.existsSync(flag)) {
  throw new Error(
    'self-test-native-marker: binding flag missing — postinstall did not run. ' +
      'Under the v2026.4 model this means trustedDependencies did not whitelist this package.',
  );
}

module.exports = { loaded: true };
