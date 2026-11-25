/**
 * G2 — 実装が引いた `var(--…)` が実在するトークン(または宣言済みの external)であること。
 *
 * G1 は「生値を書いていないこと」しか見ない。綴りを間違えた `var(--color-acccent)` は
 * 生値ではないので G1 を素通りし、**CSS としても静かに無視される**(未定義の変数は
 * 継承値か初期値になるだけで、どこにもエラーが出ない)。トークン化の利点は
 * 「間違えたら壊れる」ことなので、その 1 本をここで閉じる。
 *
 * 生成物(tokens.css)も対象にする —— そこに書かれた `var(--font-serif-jp)` のような
 * 外部変数が externals に宣言されているかは、ここでしか確かめられない。
 */

import type { Finding } from '../../kernel/finding.js';
import { scanVarUses } from '../css-scan.js';
import type { DesignInput } from '../../model/design/types.js';
import { designFinding, type DesignVerifier } from '../verifier.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 検証器 ID。 */
const ID = 'G2';

/** G2 検証器。 */
export const g2TokenReference: DesignVerifier = {
  id: ID,
  title: '実装が引いた var(--…) が実在するトークンである',

  verify(input: DesignInput): Finding[] {
    const spec = input.tokens.spec;
    if (spec === null || !input.css.available) return [];

    const tokens = new Set(spec.tokens.map((token) => token.name));
    const externals = new Set(spec.externals.map((external) => external.name));
    const findings: Finding[] = [];
    for (const file of input.css.files) {
      for (const use of scanVarUses(file.file, file.source)) {
        if (tokens.has(use.name) || externals.has(use.name)) continue;
        findings.push(
          designFinding(ID, {
            message: `実在しないトークンを参照しています: var(--${use.name})`,
            file: use.file,
            pointer: `${use.line} 行目`,
            suggestion: suggestFor(use.name, spec.tokens.map((token) => token.name), input.roots),
            counterexample: { token: use.name },
          }),
        );
      }
    }
    return findings;
  },
};

/** 綴り間違いなら近い名前を、そうでなければ足し方を案内する。 */
function suggestFor(name: string, known: readonly string[], roots: ProductRoots): string {
  const near = known.filter((candidate) => isNear(candidate, name)).slice(0, 3);
  if (near.length > 0) return `近い名前のトークンがある: ${near.join(' / ')}`;
  return `${specPath(roots, 'frontend/design/tokens.md')} の groups にトークンを足して npm run generate を実行するか、外から供給される変数なら externals に理由つきで宣言する`;
}

/** 名前が近いか(接頭辞の一致か、編集距離 1 相当の粗い判定)。 */
function isNear(candidate: string, name: string): boolean {
  if (candidate.startsWith(name) || name.startsWith(candidate)) return true;
  if (Math.abs(candidate.length - name.length) > 2) return false;
  const shorter = candidate.length <= name.length ? candidate : name;
  const longer = candidate.length <= name.length ? name : candidate;
  let skipped = 0;
  let index = 0;
  for (const char of longer) {
    if (shorter[index] === char) {
      index += 1;
      continue;
    }
    skipped += 1;
    if (skipped > 2) return false;
  }
  return true;
}
