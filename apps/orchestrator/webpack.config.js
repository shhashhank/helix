const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');
const fs = require('fs');

const DIST = join(__dirname, '../../dist/apps/orchestrator');

/**
 * The orchestrator is a Temporal **client** only — it dispatches/inspects runs but
 * never hosts workflow execution. It depends on the `@helix/workflow` project for
 * validation, and Nx's generated deploy package.json conservatively rolls up that
 * project's full Temporal dependency set (worker/workflow/activity) even though the
 * bundle never `require()`s them. This plugin prunes those from the deploy manifest
 * — but only when the emitted bundle genuinely doesn't require them, so it stays
 * correct if the app ever starts using them. Runtime behavior is unchanged either
 * way; this only trims what gets installed in production (notably the heavyweight
 * native `@temporalio/worker`).
 */
class PruneUnusedTemporalDepsPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap('PruneUnusedTemporalDeps', () => {
      const pkgPath = join(DIST, 'package.json');
      const mainPath = join(DIST, 'main.js');
      if (!fs.existsSync(pkgPath) || !fs.existsSync(mainPath)) return;

      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const bundle = fs.readFileSync(mainPath, 'utf8');
      const candidates = ['@temporalio/worker', '@temporalio/workflow', '@temporalio/activity'];

      let changed = false;
      for (const dep of candidates) {
        const required = bundle.includes(`require("${dep}")`) || bundle.includes(`require('${dep}')`);
        if (pkg.dependencies?.[dep] && !required) {
          delete pkg.dependencies[dep];
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    });
  }
}

module.exports = {
  output: {
    path: DIST,
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
    new PruneUnusedTemporalDepsPlugin(),
  ],
};
