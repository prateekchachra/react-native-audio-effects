const path = require('path');
const { getConfig } = require('react-native-builder-bob/babel-config');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');

module.exports = getConfig(
  {
    presets: ['module:@react-native/babel-preset'],
    // Reanimated 4 compiles worklets through this plugin. Without it the
    // bundle throws "Cannot read property 'bytecode' of undefined" before
    // anything renders. It must stay last in the list.
    plugins: ['react-native-worklets/plugin'],
  },
  { root, pkg }
);
