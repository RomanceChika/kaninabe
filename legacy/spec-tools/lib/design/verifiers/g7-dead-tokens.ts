/**
 * G7 — 宣言したトークンが実装から引かれていること(死語彙の検出)。
 *
 * G2 は「実装が引いた `var(--…)` が実在するトークンか」を見る(実装 → 仕様)。ここは
 * その逆向き ―― 「宣言したトークンのうち、実装のどこからも `var(--…)` で引かれていない
 * ものは無いか」(仕様 → 実装)を見る。
 *
 * 実測: radius を全廃したあとも、`tokens.md` には 4 語のトークンが緑のまま残っていた。
 * G1・G2・G3 のどれも「宣言だけあって誰も引いていない」状態を捕らない ―― トークンは
 * 「実装が使ってよい形の値域」のはずなのに、値域の側に**引かれなくなった語**が
 * 混ざっても誰も気づけない(値域の主張と実態がずれる)。
 *
 * 見るのは `app/src` の**生成物でない** CSS だけである。生成物(tokens.css)は宣言の写しに
 * すぎず「使っている」証拠にならない。TS 側の `designTokenValues` / `designTokenVars`
 * (CSS を持てない場所向けの口)からの利用は対象外 ―— 現状どこからも import されておらず、
 * ここを対象に含めると「使われている」の意味が CSS 経由と TS 経由の 2 通りに割れる。
 */

import type { Finding } from '../../kernel/finding.js';
import { absentFor } from '../../kernel/scope-owner.js';
import { DESIGN_TOKENS_ID } from '../../model/design/catalog-id.js';
import { scanVarUses } from '../css-scan.js';
import type { DesignInput } from '../../model/design/types.js';
import { designFinding, type DesignVerifier } from '../verifier.js';

/** 検証器 ID。 */
const ID = 'G7';

/** G7 検証器。 */
export const g7DeadTokens: DesignVerifier = {
  id: ID,
  title: '宣言したトークンが実装の CSS から引かれている(死語彙が残っていない)',

  verify(input: DesignInput): Finding[] {
    const spec = input.tokens.spec;
    if (spec === null || !input.css.available) return [];

    const used = new Set<string>();
    for (const file of input.css.files) {
      if (file.generated) continue;
      for (const use of scanVarUses(file.file, file.source)) used.add(use.name);
    }

    const findings: Finding[] = [];
    for (const token of spec.tokens) {
      if (used.has(token.name)) continue;
      const dead = designFinding(ID, {
        message: `トークン --${token.name} をどの実装 CSS からも参照していません(死語彙)`,
        file: spec.file,
        pointer: `groups.${token.group}.${token.name}`,
        suggestion:
          '使う画面が無いなら tokens.md からこのトークンを削除する(値域の主張は「使われている語だけがある」ことで初めて成り立つ)。' +
          '使う予定があるだけで実装がまだなら、先に var(--…) で引いてから検証をやり直す',
        counterexample: { token: token.name, group: token.group },
      });
      findings.push(absentFor({ kind: 'catalog', id: DESIGN_TOKENS_ID }, dead));
    }
    return findings;
  },
};
