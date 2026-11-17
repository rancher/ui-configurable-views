const config = require('./.shell/pkg/vue.config')(__dirname);

// EXTENSION BUILD ONLY — the built-in copy of this package in rancher/dashboard is a one-liner.
// Out here @shell is a vendored dependency (node_modules/@rancher/shell) and we import its SOURCE,
// so the type checker walks that source and fails on it: implicit-any .js models, `types/*` imports
// resolved against the shell's own tsconfig, API drift between the published shell and its types.
// Type-checking a dependency is not our job, so drop the checker and transpile only. OUR code is
// still type-checked — by `yarn type-check:ci` on the rancher/dashboard side, where @shell is real
// source in the same repo. Don't let this mask errors in our own files: keep both builds green.
const origChainWebpack = config.chainWebpack;

config.chainWebpack = (context) => {
  if (origChainWebpack) {
    origChainWebpack(context);
  }

  if (context.plugins.has('fork-ts-checker')) {
    context.plugins.delete('fork-ts-checker');
  }
};

module.exports = config;
