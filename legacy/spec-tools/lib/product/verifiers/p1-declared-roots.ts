/**
 * P1: **根は製品が宣言する** —— 宣言が実在し、宣言した根が実在することを見る。
 *
 * この検査が守っているのは 2 つある。
 *
 * ① **宣言が無いまま走ると、仕組みは自分の住んでいるリポジトリを当ててしまう。** 以前の
 *    `detectRepoRoot` は `.git` を探しており、見つからなければ起点の親を返していた —— つまり
 *    「間違った根で静かに走る」形が既定だった。`?? ''` で空文字が流れて `path.join('', 'app')`
 *    が相対パス `app` になり、ホストの接続層と seed を書き潰した事故はこの形の系である。
 *    宣言が無いことを**最初にエラーにする**のがその再発を止める一番安い方法である。
 *
 * ② **仕様の木が無いのはエラーである。** 仕様が正なのだから、正の在り処が間違っていたら後続の
 *    すべてが空振りする。
 *
 * **他の根の不在は言わない。** 生成物・migration・読み物は `generate` が書くものであり、実装の木・
 * ドメイン知識は「まだ書いていない」が正当な状態である —— そこで警告を出すと、新しい製品が
 * **消せない warning を抱えたまま始まる**(G8 が「placeholder を宣言し続ける以外に消せない
 * warning を作らない」と決めた線と同じ)。しかも範囲が縮んだ検査は各群のスコープ行が
 * 「実装の木が無いため … はスキップ」として既に宣言しており、ここで重ねる意味が無い。
 * 綴り間違いは「そこを読む検査が何も見つけない」形で現れ、スコープ行がそれを声に出す。
 *
 * 散文の正は placement_policy.md「根は製品が宣言する」。
 */

import path from 'node:path';
import { isDirectory, PRODUCT_DECL_FILE } from '../../io/paths.js';
import type { Finding } from '../../kernel/finding.js';
import type { ProductRootsModel } from '../../model/product/types.js';

/** 検証器 ID。 */
export const P1_VERIFIER_ID = 'P1';

/** P1 の入力。 */
export interface DeclaredRootsInput {
  /** リポジトリルートの絶対パス。 */
  readonly repoRoot: string;
  /** 読み込んだ宣言。 */
  readonly product: ProductRootsModel;
}

/**
 * 宣言の実在と、宣言した根の実在を検査する。
 *
 * @param input リポジトリルートと読み込んだ宣言
 * @returns P1 違反
 */
export function verifyDeclaredRoots(input: DeclaredRootsInput): Finding[] {
  const location = { file: PRODUCT_DECL_FILE };
  if (!input.product.available) {
    return [
      {
        verifier: P1_VERIFIER_ID,
        severity: 'error',
        message: `製品の根の宣言(${PRODUCT_DECL_FILE})がありません`,
        location,
        suggestion:
          `リポジトリ直下に ${PRODUCT_DECL_FILE} を置き、roots に仕様の木・読み物・生成物・migration の` +
          '位置を宣言する(実装の木を持つなら app も)。仕組みはこの宣言だけを読んでパスを組み立てる',
      },
    ];
  }
  const roots = input.product.roots;
  // 宣言が読めなかった場合の文言は P0(ローダー)が持つ。ここで重ねない。
  if (roots === null) return [];

  if (isDirectory(path.join(input.repoRoot, roots.specs))) return [];
  return [
    {
      verifier: P1_VERIFIER_ID,
      severity: 'error',
      message: `宣言した仕様の木 ${roots.specs} がありません`,
      location: { file: PRODUCT_DECL_FILE, pointer: 'roots.specs' },
      suggestion:
        `その位置に仕様の木を作るか、roots.specs を実在する位置に直す` +
        '(仕様が正なので、正の在り処が違っていると以降の検査は全部空振りして緑になる)',
      counterexample: { declared: roots.specs },
    },
  ];
}
