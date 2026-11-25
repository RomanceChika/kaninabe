/**
 * W2: **アプリ側の仕組みの層の散文**(行コメント・doc コメント)に、仕様が宣言した id が
 * 例示の印なしで書かれていないこと。
 *
 * W1 は文字列リテラルだけを見る。検査の漏れ探し(2026-09-12 §6)は、その視界の外で
 * **仕組み側の doc コメントがアプリの語で仕組みを説明している**箇所を実測した
 * (`_template/actor.ts` の「集約ごとに違う(`entry.performer_id` / `workshop.organizer_id`)」・
 * `components/screen-path.ts` の `workshop_manage` / `/workshops/:id` 等)。
 * 実行時の挙動は変わらないが、**読み手には仕組みがその集約を知っているように見える**し、
 * 別のアプリに移した瞬間に嘘になる文である。
 *
 * ## 重さと消し込みの単位
 *
 * **warning** である(W1 のリテラルは error)。散文は文脈が緩く、同じ綴りの一般語との
 * 衝突が避けられないためで、error にすると「コメントを書くな」という別の規則に化ける。
 * 報告は**ファイル 1 件につき 1 件**にまとめる —— 直すときは 1 ファイルの散文をまとめて
 * 見直すのであって、行ごとに直すものではないからである(W1 の `unresolved` と同じ形)。
 *
 * ## 消し込みの道は 2 つ
 *
 *   1. **例示だと明示する**: その行に `例:` を書く(規約: dsl-extension-triage.md §軸と語)。
 *      「アプリの語を書くな」ではなく「例だと明示せずに書くな」が規則である。
 *   2. **散文を一般語に書き換える**: 仕組みの説明としてアプリの集約名が要るなら、
 *      それは軸の宣言が足りないサインである(W1 と同じ読み方)。
 */

import type { SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import { collectDomainVocabulary } from './w1-vocabulary-leak.js';
import { scanVocabularyProse, type VocabularyProseHit } from '../prose-scan.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';

export const VERIFIER_ID = 'W2';

/**
 * 散文でだけ起きる既知の衝突(体系側・プラットフォーム側の語が同じ綴りを持つ)。
 *
 * W1 の `KNOWN_COLLISIONS` と同じ性質の宣言だが、**リテラルとは衝突する語が違う**
 * ので表を分ける(リテラルでは型の判別子が衝突し、散文では DOM の属性名や
 * DSL のキー名が衝突する)。**1 項ごとに範囲・扱い・理由を報告する**のは W1 と同じ形である
 * (独立レビュー 束 ㉑ の 6-B。それまでは 6 語の裸の Set が全域に効いており、理由は
 * doc コメントにまとめ書きされていた —— この体系が普段禁じている形の免除リストだった)。
 */
interface ProseCollision {
  /** 対象の語。 */
  readonly words: readonly string[];
  /**
   * 効く範囲。`'all'` はファイルを問わない(体系側の値域・道具の名前と綴りが同じ語)。
   * 配列のときは `file` に対する部分一致のいずれか 1 つで当たる。
   */
  readonly files: 'all' | readonly string[];
  /**
   * その項をどう扱うか(W1 の `KNOWN_COLLISIONS` と同じ語彙)。
   *
   *   - `accepted` … 衝突は誤検出であり、直す先が無い(体系の値域・DOM の属性名・引数名)。
   *     ヒットを除く。
   *   - `unresolved` … **仕組み側の穴として残っている**(受理ではなく記録)。ヒットを除かない
   *     ので、その語は普段どおり warning に出続ける —— 散文だけを事実に合わせて機構は
   *     黙らせるままにしない(W1 と同じ思想)。
   */
  readonly status: 'accepted' | 'unresolved';
  readonly reason: string;
}

const PROSE_COLLISIONS: readonly ProseCollision[] = [
  {
    words: ['system', 'anonymous'],
    files: 'all',
    status: 'accepted',
    reason:
      'role_spec の `kind` の値域(フレームワーク固定の 3 スロットの呼び名)であり、' +
      '散文では「system 経路」「anonymous として記録される」のように**体系の語として**使われる。' +
      'W1 が `ROLE_KINDS` の同じ 2 語を `accepted` にしているのと同じ理由である。',
  },
  {
    words: ['none'],
    files: 'all',
    status: 'accepted',
    reason:
      '`ReadScope.kind` 等の判別子であり(W1 の `GENERIC_COLLISIONS` と同じ語)、' +
      '散文でも「none に倒す」のように体系側の固定値として書かれる。',
  },
  {
    words: ['required'],
    files: 'all',
    status: 'accepted',
    reason:
      'entity_spec の fields[] のキー名(`required:`)と config カタログの `requirement` 語彙であり、' +
      'DSL 自身のスキーマの語である。',
  },
  {
    words: ['accept'],
    files: 'all',
    status: 'accepted',
    reason: 'usecase_spec / access_spec の「理由つき受け入れ」のキー名(`accept:`)であり、DSL 固定である。',
  },
  {
    words: ['generate'],
    files: 'all',
    status: 'accepted',
    reason: '道具の名前(`npm run generate`)であり、散文はコマンドとして書いている。',
  },
  {
    words: ['confirm'],
    files: ['action-runner/'],
    status: 'accepted',
    reason:
      '`ux.confirm` は action_spec のスキーマのキー名(DSL 固定)であり、`workshop.confirm`' +
      '(イベント ID)とは無関係にたまたま綴りが同じ(W1 の同名の項と同じ理由)。',
  },
  {
    words: ['resolve'],
    files: ['action-runner/'],
    status: 'accepted',
    reason:
      '送信前検証のプロップ名(`resolve`)と JS の Promise の語であり、' +
      '`inquiry.resolve`(イベント ID)とは無関係である。',
  },
  {
    words: ['disabled'],
    files: ['action-runner/', '/walker'],
    status: 'accepted',
    reason:
      'HTML の属性名(`disabled`)であり、`membership.disabled`(状態 ID)とは無関係である。' +
      'ウォーカーの走査も「押せないボタンを除く」の意味で DOM の属性名として書いている。',
  },
  {
    words: ['left'],
    files: ['domain/engine/guard.ts'],
    status: 'accepted',
    reason:
      'ガード式の**左辺**を指す引数名(`@param left - 左辺`)であり、`membership.left`' +
      '(状態 ID)とは無関係にたまたま綴りが同じである。',
  },
  {
    words: ['secret'],
    files: ['inbound/signature.ts'],
    status: 'accepted',
    reason:
      '署名検証に渡す**共有秘密**の引数名であり、config カタログの `kind: secret`(設定の種別の' +
      '語彙)と綴りが同じだけである。受信口はどの設定を鍵にするかを知らず、値を受け取るだけである。',
  },
];

/** そのヒットが既知の衝突に当たるか(`unresolved` の項は除かない = 記録として warning に残す)。 */
function isKnownCollision(hit: VocabularyProseHit): boolean {
  return PROSE_COLLISIONS.some(
    (entry) =>
      entry.status === 'accepted' &&
      entry.words.includes(hit.word) &&
      (entry.files === 'all' || entry.files.some((pattern) => hit.file.includes(pattern))),
  );
}

/**
 * ファイル 1 件ぶんの warning を組み立てる。
 *
 * @param file リポジトリルート相対パス
 * @param hits そのファイルのヒット(1 件以上)
 * @returns warning の Finding(場所は最初のヒット。語と箇所を反例に載せる)
 */
function proseFinding(file: string, hits: readonly VocabularyProseHit[]): Finding {
  const first = hits[0];
  const words = [...new Set(hits.map((hit) => hit.word))];
  return {
    verifier: VERIFIER_ID,
    severity: 'warning',
    message:
      `${file} の散文に仕様の語(${words.join(' / ')})が ${hits.length} 箇所あります` +
      '(仕組みの層のコメントが、このアプリの集約を知っているように読める)',
    location: first === undefined ? { file } : { file, pointer: `L${first.line}` },
    suggestion:
      `例として挙げているだけなら、その行に「例:」を書く(印のある行は対象外になる)。` +
      '仕組みの説明にアプリの語が要るなら、それは軸の宣言が足りないサインである ' +
      '(dsl-extension-triage.md §軸と語)。散文を一般語に書き換えるか、軸を仕様側に開く',
    counterexample: {
      words: words.join(' / '),
      occurrences: String(hits.length),
      at: hits.map((hit) => `${hit.file}:${hit.line}`).join(', '),
    },
  };
}

/**
 * 走査結果を Finding にまとめる(純粋関数。テスト用に分離)。
 *
 * @param hits 散文のヒット
 * @returns ファイルごとに 1 件の warning
 */
export function groupProseHits(hits: readonly VocabularyProseHit[]): Finding[] {
  const byFile = new Map<string, VocabularyProseHit[]>();
  for (const hit of hits) {
    if (isKnownCollision(hit)) continue;
    const collected = byFile.get(hit.file);
    if (collected === undefined) byFile.set(hit.file, [hit]);
    else collected.push(hit);
  }
  return [...byFile].map(([file, fileHits]) => proseFinding(file, fileHits));
}

/**
 * アプリ側の仕組みの層の散文を検査する。
 *
 * @param model 構築済みのドメイン仕様モデル(集約・ロール・状態・イベントの母集合)
 * @param catalogVocabulary カタログ系の語彙軸 id
 * @param repoRoot リポジトリルートの絶対パス(走査の起点)
 * @param roots 製品が宣言した根(走査範囲の位置)
 * @param layout 置き場の配置(走査範囲の層と土台の表の宣言元)
 * @returns 違反のリスト(ファイルごとに 1 件の warning)
 */
export function verifyProseLeak(
  model: SpecModel,
  catalogVocabulary: ReadonlySet<string>,
  repoRoot: string,
  roots: ProductRoots,
  layout: ProductLayout,
): { readonly findings: Finding[]; readonly exemptedLines: number } {
  const vocabulary = new Set([...collectDomainVocabulary(model), ...catalogVocabulary]);
  const { hits, exemptedLines } = scanVocabularyProse(repoRoot, vocabulary, roots, layout);
  return { findings: groupProseHits(hits), exemptedLines };
}
