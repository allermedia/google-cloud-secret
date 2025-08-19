import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import commonjs from '@rollup/plugin-commonjs';

const nodeRequire = createRequire(fileURLToPath(import.meta.url));
const { peerDependencies, optionalDependencies, exports } = nodeRequire('./package.json');

const external = new Set(
  ['node:path/posix', 'node:crypto'].concat(Object.keys(peerDependencies)).concat(Object.keys(optionalDependencies ?? []))
);

export default Object.values(exports).map((exp) => {
  return {
    input: exp.import,
    external: [...external],
    plugins: [commonjs()],
    output: [
      {
        file: exp.require,
        exports: 'named',
        format: 'cjs',
        footer: 'module.exports = Object.assign(exports.default, exports);',
      },
    ],
  };
});
