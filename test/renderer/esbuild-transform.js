// Jest transformer for renderer ES modules.
//
// The renderer sources use native ESM (import/export) and run unbundled in
// the browser via <script type="module">, but Jest executes in Node where
// those files need to be CommonJS. esbuild converts them losslessly.
//
// Only files under renderer/ match this transform (see the jest config in
// package.json), so main-process modules and existing tests are untouched.
const { transformSync } = require('esbuild');

module.exports = {
  process(sourceText, filename) {
    const result = transformSync(sourceText, {
      loader: 'js',
      format: 'cjs',
      target: 'es2020',
      sourcefile: filename,
      sourcemap: 'inline'
    });
    return { code: result.code, map: null };
  }
};
