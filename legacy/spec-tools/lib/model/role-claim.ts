/**
 * role_spec の `claim`(実行者自身の行の欄が根拠のロール)の文法と、その分解。
 *
 * 書ける形は 3 つだけである(ADR-0018)。
 *
 * | 書き方 | 意味 |
 * |---|---|
 * | `{entity}.{field}` | boolean の欄が真 |
 * | `{entity}.{field} == {値}` | state / enum の欄がその値 |
 * | `{entity}.{field} in [{値}, ...]` | state / enum の欄が値の集合のどれか |
 *
 * ここが見るのは**形**だけである(パスが 2 セグメントか・値が識別子か・重複が無いか)。欄が実在し
 * `session: true` か・型が合うか・値が値域にあるかは V11 が見る —— パーサーは 1 ファイルの中で
 * 閉じた形式しか見ない(他の仕様との突合は検証器の役目)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { RoleDef } from './types.js';

/** `claim` が指す欄のパス(`{entity}.{field}` の 2 セグメント)。 */
const CLAIM_PATH = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** 値の 1 語(状態 ID / enum の値の綴り)。 */
const CLAIM_VALUE = /^[A-Za-z0-9_]+$/;

/** `{パス} == {値}`。 */
const EQUALS_FORM = /^(\S+)\s*==\s*(\S+)$/;

/** `{パス} in [{値}, ...]`。 */
const IN_FORM = /^(\S+)\s+in\s*\[(.*)\]$/;

/** `claim` の文字列を読んだ結果。 */
export type ClaimParse =
  | {
      readonly ok: true;
      /** 欄のパス(`{entity}.{field}`)。 */
      readonly path: string;
      /** 値の集合(宣言順)。boolean の欄なら `null`。 */
      readonly values: readonly string[] | null;
    }
  | { readonly ok: false; readonly reason: string };

/** `claim` を分解したもの(実行者の行のどの欄を、どの値で見るか)。 */
export interface ClaimParts {
  readonly entity: string;
  readonly field: string;
  /** 値の集合。boolean の欄(従来の形)なら `null`。 */
  readonly values: readonly string[] | null;
}

/**
 * `claim` の文字列を読む。
 *
 * @param text role_spec の `claim` に書かれた文字列
 * @returns 欄のパスと値の集合、または形が合わない理由
 */
export function parseClaimText(text: string): ClaimParse {
  const trimmed = text.trim();
  if (CLAIM_PATH.test(trimmed)) return { ok: true, path: trimmed, values: null };
  const equals = EQUALS_FORM.exec(trimmed);
  if (equals?.[1] !== undefined && equals[2] !== undefined) {
    return finish(equals[1], [equals[2]]);
  }
  const among = IN_FORM.exec(trimmed);
  if (among?.[1] !== undefined && among[2] !== undefined) {
    return finish(
      among[1],
      among[2].split(',').map((value) => value.trim()),
    );
  }
  return {
    ok: false,
    reason: '"{entity}.{field}" / "{entity}.{field} == {値}" / "{entity}.{field} in [{値}, ...]" のどれでもありません',
  };
}

/** パスと値の集合を検査して結果にする。 */
function finish(path: string, values: readonly string[]): ClaimParse {
  if (!CLAIM_PATH.test(path)) {
    return { ok: false, reason: `欄のパス ${path} が "{entity}.{field}" の形式ではありません` };
  }
  const bad = values.find((value) => !CLAIM_VALUE.test(value));
  if (bad !== undefined) {
    return { ok: false, reason: `値 "${bad}" は綴り(英数字と _ だけ)として読めません` };
  }
  const repeated = values.find((value, index) => values.indexOf(value) !== index);
  if (repeated !== undefined) return { ok: false, reason: `値 ${repeated} が重複しています` };
  return { ok: true, path, values };
}

/**
 * ロールの `claim` を分解する。
 *
 * @param role ロール定義
 * @returns 実行者の行の欄と値の集合。`claim` を持たない(または形が壊れている)ロールは `null`
 */
export function claimPartsOf(role: RoleDef): ClaimParts | null {
  if (role.claim === undefined) return null;
  const dot = role.claim.indexOf('.');
  if (dot < 0) return null;
  return {
    entity: role.claim.slice(0, dot),
    field: role.claim.slice(dot + 1),
    values: role.claimValues ?? null,
  };
}

/**
 * `claim` を宣言の綴りに戻す(メッセージ・反例用)。
 *
 * @param role ロール定義
 * @returns `{entity}.{field} in [a, b]` のような綴り。`claim` を持たなければ空文字
 */
export function claimText(role: RoleDef): string {
  if (role.claim === undefined) return '';
  const values = role.claimValues;
  if (values === undefined) return role.claim;
  return values.length === 1 ? `${role.claim} == ${values[0] ?? ''}` : `${role.claim} in [${values.join(', ')}]`;
}

/**
 * 実行者自身の行の欄の条件(`claim` の根拠。実行時の計画・ロール解決の表に出る形)。
 *
 * `values` が無ければ boolean の欄が真であること、あれば state / enum の欄が値の集合のどれかであること。
 * 実行時パッケージの `RunRowCondition` と同じ形で、`values` の無い条件は鍵ごと持たない
 * (宣言しなければ生成物は変わらない)。
 */
export interface RowCondition {
  readonly field: string;
  readonly values?: readonly string[];
}

/**
 * ロールの `claim` を行の条件にする。
 *
 * @param role ロール定義
 * @returns 行の条件。`claim` を持たない(または形が壊れている)ロールは `null`
 */
export function rowConditionOf(role: RoleDef): RowCondition | null {
  const parts = claimPartsOf(role);
  if (parts === null) return null;
  return parts.values === null ? { field: parts.field } : { field: parts.field, values: parts.values };
}

/**
 * 条件を重複なく足す(同じ欄・同じ値の集合は 1 つにする)。
 *
 * @param into 足し先(並びを保つ)
 * @param condition 足す条件
 */
export function addCondition(into: RowCondition[], condition: RowCondition): void {
  const same = (other: RowCondition): boolean =>
    other.field === condition.field && (other.values ?? []).join('\n') === (condition.values ?? []).join('\n');
  if (!into.some(same)) into.push(condition);
}
