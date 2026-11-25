/**
 * auth_spec パーサーが共有する小さな読み取りヘルパー。
 *
 * `parse-auth.ts` と `parse-auth-axes.ts` の両方が使う。ここには判断を持たず、YAML の型付け・
 * 重複チェック・値域の判定という機械的な処理だけを置く。
 */

import type { SpecReporter } from '../parse-common.js';
import type { YamlReader } from '../yaml-reader.js';

/** スネークケース(行の id・状態・排他表示のキー)。 */
const SNAKE = /^[a-z][a-z0-9_]*$/;

/** 行の id(スネークケース)を読む。 */
export function readSnakeId(item: YamlReader, base: string, kind: string, reporter: SpecReporter): string | null {
  const id = item.requiredString('id', `id に${kind}の名前(スネークケース)を書く`);
  if (id === null) return null;
  if (!SNAKE.test(id)) {
    reporter.error(`${base}.id`, `${kind} ${id} がスネークケースではありません`, 'スネークケースに直す', { id });
    return null;
  }
  return id;
}

/** 1 本のリストの中の id の重複を見張る。重複した行は数えておく(先に出た同じ id の行がモデルに残るので、仕様は欠けない)。 */
export class IdClaims {
  private readonly seen = new Set<string>();
  /** 重複で落とした行の数(`SpecReporter.settleRows` の引き算に使う)。 */
  duplicates = 0;

  /** 既出なら違反を記録して false。 */
  claim(id: string, pointer: string, kind: string, reporter: SpecReporter): boolean {
    if (!this.seen.has(id)) {
      this.seen.add(id);
      return true;
    }
    reporter.error(pointer, `${kind} ${id} が重複しています`, '重複した行を削除する', { id });
    this.duplicates += 1;
    return false;
  }
}

/**
 * 値域の軸を読む。
 *
 * @returns 値 / 未宣言なら undefined / 値域の外なら null(呼び出し側が行ごと落とす)
 */
export function readEnum<T extends string>(
  item: YamlReader,
  key: string,
  allowed: readonly T[],
  reporter: SpecReporter,
  required = false,
): T | undefined | null {
  const suggestion = `${key} は ${allowed.join(' / ')} のいずれかを書く`;
  const value = required ? item.requiredString(key, suggestion) : item.optionalString(key, suggestion);
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    reporter.error(item.pointer(key), `${key} ${value} は宣言できる語ではありません`, suggestion, { [key]: value });
    return null;
  }
  return value as T;
}
