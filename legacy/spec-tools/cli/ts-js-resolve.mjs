/**
 * `node` で `.ts` を直に読むときの import の向け直し(`deps:check:offline` が依存を入れる前に走るための口。6 回目 C6-3)。
 *
 * この道具の木は `import … from './x.js'`(TypeScript の NodeNext の綴り)で書き、実体は `./x.ts` である。Node の型の除去は
 * `.ts` を読めるが綴りの向け直しはしないので、相対の `.js` の指定で実体が無く、隣に `.ts` があるときだけ `.ts` へ向ける。
 * ほかの指定(パッケージ名・`node:`・実在する `.js`)には触らない。
 *
 * 使い方: node --import ./cli/ts-js-resolve.mjs cli/deps-check-offline.ts
 */

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL;
    if (parent?.startsWith('file:') && /^\.\.?\//.test(specifier) && specifier.endsWith('.js')) {
      const asJs = new URL(specifier, parent);
      const asTs = new URL(`${specifier.slice(0, -'.js'.length)}.ts`, parent);
      if (!existsSync(fileURLToPath(asJs)) && existsSync(fileURLToPath(asTs))) return nextResolve(asTs.href, context);
    }
    return nextResolve(specifier, context);
  },
});
