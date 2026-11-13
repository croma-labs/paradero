// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // The MCP SDK publishes its subpaths through a wildcard export map that this resolver can't read. tsc still checks them.
    rules: { 'import/no-unresolved': ['error', { ignore: ['^@modelcontextprotocol/sdk/'] }] },
  },
]);
