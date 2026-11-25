/**
 * 遷移テーブルの簡易整合チェック。
 *
 * 生成物（`../generated/`）は仕様検証器（V1〜V11）を通っている前提だが、
 * **テスト用の手書き表**や生成器の改修中の事故は素通りしてしまう。ここでは
 * 「エンジンがそのまま解釈すると誤った判定を返す」構造的な壊れ方だけを、
 * 実行時の依存なしに検出する。
 *
 * 到達可能性（V5）・デッドエンド（V6）・ガード充足性（V9）は仕様側の検証器の担当であり、
 * ここでは見ない（同じ検査を二重に持たない）。
 */

import type { MachineTable, TransitionDef } from './types';

/** 遷移を人間が特定できる短い表現にする（メッセージ用）。 */
function label(transition: TransitionDef): string {
  return `遷移 ${transition.event}(from: ${transition.from.join(', ')})`;
}

/** 重複している要素を列挙する（出現順・重複なし）。 */
function duplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const found = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) found.add(value);
    seen.add(value);
  }
  return [...found];
}

/** 状態集合そのものの整合（states / initial / final）。 */
function checkStates(table: MachineTable): readonly string[] {
  const problems: string[] = [];
  if (table.states.length === 0) {
    problems.push('states が空です。少なくとも1つの状態を定義してください');
  }
  for (const duplicated of duplicates(table.states)) {
    problems.push(`states に状態 ${duplicated} が重複しています。1回だけ書いてください`);
  }
  if (!table.states.includes(table.initial)) {
    problems.push(
      `initial の ${table.initial} が states にありません。states に加えるか initial を修正してください`,
    );
  }
  for (const state of table.final) {
    if (!table.states.includes(state)) {
      problems.push(
        `final の ${state} が states にありません。states に加えるか final から外してください`,
      );
    }
  }
  return problems;
}

/** 遷移1本の形（必須項目・参照先の実在・final からの離脱）。 */
function checkTransition(table: MachineTable, transition: TransitionDef): readonly string[] {
  const problems: string[] = [];
  if (transition.event === '') {
    problems.push('event が空の遷移があります。ドメインイベントIDを書いてください');
  }
  if (transition.from.length === 0) {
    problems.push(`${label(transition)}: from が空です。遷移元の状態を1つ以上書いてください`);
  }
  if (transition.by.length === 0) {
    problems.push(
      `${label(transition)}: by が空です。この遷移を実行してよいロールを1つ以上書いてください（誰も起こせない遷移は表から消してください）`,
    );
  }
  for (const state of transition.from) {
    if (!table.states.includes(state)) {
      problems.push(`${label(transition)}: from の ${state} が states にありません`);
    }
    if (table.final.includes(state)) {
      problems.push(
        `${label(transition)}: final 状態 ${state} が from にあります。final から出る遷移は書けません`,
      );
    }
  }
  if (!table.states.includes(transition.to)) {
    problems.push(`${label(transition)}: to の ${transition.to} が states にありません`);
  }
  return problems;
}

/**
 * 同一（イベント, 遷移元状態）に複数の遷移が定義されていないか。
 *
 * `canFire` は最初に一致した1本を使うため、重複があると「表の並び順」で結果が変わる。
 * from が排他であれば遷移は一意に定まる、という前提をここで守る。
 */
function checkDeterminism(table: MachineTable): readonly string[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const problems: string[] = [];
  for (const transition of table.transitions) {
    for (const state of transition.from) {
      const key = `${transition.event}@${state}`;
      if (seen.has(key) && !reported.has(key)) {
        reported.add(key);
        problems.push(
          `イベント ${transition.event} が状態 ${state} に対して複数定義されています。from を排他にするか、イベントを分けてください`,
        );
      }
      seen.add(key);
    }
  }
  return problems;
}

/**
 * 遷移テーブルの整合を検査し、問題の一覧を返す。
 *
 * 名前に反して例外は投げない。呼び出し側（テスト・生成物の受け入れ確認）が
 * 結果を見て落とす。空配列なら問題なし。
 *
 * 検査するもの: states の重複、initial / final / from / to の実在、from・by が空でないこと、
 * final から出る遷移が無いこと、同一（イベント, 状態）の遷移が一意であること。
 *
 * @param table - 検査する遷移テーブル
 * @returns 問題の説明（「何が・どこで・どう直すか」）の配列。問題が無ければ空配列
 */
export function assertValidTable(table: MachineTable): string[] {
  const problems: string[] = [];
  if (table.machine === '') {
    problems.push('machine が空です。状態機械の名前を書いてください');
  }
  problems.push(...checkStates(table));
  for (const transition of table.transitions) {
    problems.push(...checkTransition(table, transition));
  }
  problems.push(...checkDeterminism(table));
  return problems;
}
