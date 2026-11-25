/**
 * PlusCal の**翻訳の一致**の判定(C24 の第 2 段)。
 *
 * モデルは PlusCal(アルゴリズム言語)で書き、TLA+ への翻訳結果を同じファイルに
 * コミットする。翻訳結果は生成物なので、検査は翻訳し直して差分 0 を見る
 * (`generate:check` と同じ流儀)—— 手で翻訳結果だけを直せば、読んでいる模型と
 * 走っている模型がずれる。
 *
 * 純粋関数であり throw しない(pcal.trans の起動は CLI の仕事)。
 */

import type { FormalFinding } from './types.js';

/** 翻訳結果の始まりと終わり(pcal.trans が書く目印)。 */
const BEGIN = '\\* BEGIN TRANSLATION';
const END = '\\* END TRANSLATION';

/**
 * `.tla` の本文から翻訳結果の区間を切り出す。
 *
 * @param text `.tla` の全文
 * @returns 目印に挟まれた本文(改行で区切った行)。目印が揃っていなければ null
 */
export function translationBlock(text: string): readonly string[] | null {
  const lines = text.split('\n');
  const begin = lines.findIndex((line) => line.startsWith(BEGIN));
  const end = lines.findIndex((line) => line.startsWith(END));
  if (begin === -1 || end === -1 || end < begin) return null;
  return lines.slice(begin + 1, end).map((line) => line.trimEnd());
}

/**
 * コミット済みの翻訳結果と、翻訳し直した結果を突き合わせる。
 *
 * @param model モジュール名
 * @param committed リポジトリに入っている `.tla` の全文
 * @param retranslated pcal.trans を回した後の `.tla` の全文
 * @returns 食い違いがあれば 1 件の Finding、無ければ空配列
 */
export function translationFindings(
  model: string,
  committed: string,
  retranslated: string,
): FormalFinding[] {
  const before = translationBlock(committed);
  if (before === null) {
    return [
      {
        severity: 'error',
        message: `${model}: 翻訳結果の目印(BEGIN / END TRANSLATION)が揃っていません`,
        location: `formal/${model}.tla`,
        suggestion: '`\\* BEGIN TRANSLATION` と `\\* END TRANSLATION` の 2 行を置いて pcal.trans を回す',
      },
    ];
  }
  const after = translationBlock(retranslated);
  if (after === null) {
    return [
      {
        severity: 'error',
        message: `${model}: 翻訳し直した結果に目印がありません(pcal.trans が翻訳できていません)`,
        location: `formal/${model}.tla`,
        suggestion: 'PlusCal の本文(`(*--algorithm … *)`)が壊れていないかを確かめる',
      },
    ];
  }
  if (before.join('\n') === after.join('\n')) return [];
  const firstDiff = before.findIndex((line, index) => line !== after[index]);
  const at = firstDiff === -1 ? Math.min(before.length, after.length) : firstDiff;
  return [
    {
      severity: 'error',
      message: `${model}: コミットされた翻訳結果が、PlusCal から翻訳し直した結果と一致しません`,
      location: `formal/${model}.tla`,
      suggestion:
        'PlusCal を直したら翻訳し直してコミットする(`java -cp <tla2tools.jar> pcal.trans ' +
        `-nocfg -unixEOL formal/${model}.tla`.concat('`)。翻訳結果を手で編集しない'),
      detail: [
        `最初に食い違った行: 翻訳結果の ${at + 1} 行目`,
        `コミット済み: ${before[at] ?? '(行が無い)'}`,
        `翻訳し直し  : ${after[at] ?? '(行が無い)'}`,
      ],
    },
  ];
}
