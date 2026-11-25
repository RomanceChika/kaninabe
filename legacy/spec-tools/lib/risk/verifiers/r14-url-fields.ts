/**
 * R14 **URL を自由な文字列で書いた欄**(危ない形の群。規則の正は enforcement-matrix の C32)。
 *
 * 外へのリンクになりうる文字列は、`format: url`(絶対 URL の http / https だけ)で書く。`format: url` は入力スキーマ(zod)・表の CHECK・
 * world の値・表示側の安全なリンクの部品(`@kaninabe/runtime/url` の `safeHttpUrl`)を**同じ 1 つの宣言**から出す。`pattern` に URL の綴りを
 * 手で書くと、世界(テストの行)を作れず生成テストが丸ごと消え、書式の強さも製品ごとにばらつく(点検の F11 は `pattern` で代用して
 * この両方を踏んだ)。`javascript:` / `data:` を `href` に出す XSS と、偽決済への誘導の口になる。
 *
 * 見る形は 1 つである(**構造**。意図の宣言は要らない)。
 *
 * | 止める形 | 直し方 |
 * |---|---|
 * | `pattern` の綴りが URL の文法を手で書いている(`http` / `://` / `script:` を含む) | `pattern` を消して `format: url` を書く |
 *
 * **欄の名前で URL かどうかを決めない**(`_url` で終わる名前を見る案は、名前を変えれば素通りするうえ、URL でない欄を誤って巻き込む)。
 * 画面の `href` / `src` に自由な文字列が入る側の穴は、仕様でなく**実装の木**で止める(ESLint の `layer/require-safe-link`)。
 * 読むのは欄の宣言だけで、**アプリの語彙は 1 語も持たない**。純関数であり throw しない。
 */

import type { FieldDef, SpecModel } from '../../model/types.js';
import { makeFinding, type Finding } from '../../kernel/finding.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'R14';

/** URL の文法を手で書いた `pattern` の綴り(スキーム名・`://`・`script:` のどれかを含む)。 */
const HAND_ROLLED_URL = /http|:\/\/|:\\\/\\\/|script:/i;

/** 欄 1 つの指摘(無ければ空)。 */
function checkField(entity: string, field: FieldDef): Finding[] {
  if (field.pattern === undefined || !HAND_ROLLED_URL.test(field.pattern)) return [];
  const place = `${entity}.${field.name}`;
  return [
    makeFinding(VERIFIER_ID, {
      message: `${place} は pattern で URL の文法を書いています(pattern では world を作れず生成テストが消え、書式の強さも欄ごとにばらつきます)`,
      location: field.location,
      suggestion: 'pattern を消して format: url を書く(絶対 URL の http / https だけを、入力スキーマ・CHECK・world の値・表示側の safeHttpUrl が同じ宣言から出す)',
      counterexample: { entity, field: field.name, pattern: field.pattern },
    }),
  ];
}

/**
 * R14: 全集約の欄に、URL を自由な `pattern` で書いたものが無いかを見る。
 *
 * @param model ドメイン仕様全体
 * @returns 違反(無ければ空)
 */
export function verifyUrlFields(model: SpecModel): Finding[] {
  return [...model.aggregates.values()].flatMap((specs) =>
    specs.entity === undefined ? [] : specs.entity.fields.flatMap((field) => checkField(specs.entity?.entity ?? specs.name, field)),
  );
}
