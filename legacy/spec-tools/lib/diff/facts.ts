/**
 * 2 版の「事実の表」を突き合わせる共通部。
 *
 * どの軸も形は同じである —— 生成物から **鍵 → 中身** の表を作り、鍵の出入りと中身の入れ替わりを
 * 見る。鍵が片側にしか無い形がそのまま §3-3 の「基点に無い生成物は全行が増えた側」になるので、
 * ファイルの不在を特別扱いする分岐を持たずに済む(不在の版は表が空になるだけである)。
 *
 * **名前の変更は「消えた + 増えた」**として出る(改名の推定はしない。設計メモ §3-2)。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

/** 事実の表(鍵 → 中身)。 */
export type FactTable = ReadonlyMap<string, string>;

/** 突き合わせの結果 1 件。 */
export interface FactDelta {
  readonly key: string;
  /** 基点側の中身(無ければ null)。 */
  readonly before: string | null;
  /** 比較先の中身(無ければ null)。 */
  readonly after: string | null;
  /** 出入りか、中身の入れ替わりか。 */
  readonly kind: 'added' | 'removed' | 'changed';
}

/**
 * 2 版の事実の表を突き合わせる。
 *
 * @param base 基点側の表
 * @param head 比較先の表
 * @returns 鍵の順(辞書順)の差分。変わっていない鍵は含まない
 */
export function diffFacts(base: FactTable, head: FactTable): readonly FactDelta[] {
  const keys = [...new Set([...base.keys(), ...head.keys()])].sort();
  const deltas: FactDelta[] = [];
  for (const key of keys) {
    const before = base.get(key);
    const after = head.get(key);
    if (before === after) continue;
    if (before === undefined) {
      deltas.push({ key, before: null, after: after ?? null, kind: 'added' });
      continue;
    }
    if (after === undefined) {
      deltas.push({ key, before, after: null, kind: 'removed' });
      continue;
    }
    deltas.push({ key, before, after, kind: 'changed' });
  }
  return deltas;
}

/** 表を組み立てる小道具(同じ鍵が 2 度来たら後勝ちにせず、先に入った方を残す)。 */
export class FactBuilder {
  private readonly entries = new Map<string, string>();

  /**
   * 事実を 1 件足す。
   *
   * @param key 鍵(軸ごとの組み立て方は各判定器が持つ)
   * @param value 中身(比較はこの文字列の一致で行う)
   */
  add(key: string, value: string): void {
    if (!this.entries.has(key)) this.entries.set(key, value);
  }

  /** 組み立てた表。 */
  table(): FactTable {
    return this.entries;
  }
}

/**
 * 鍵の区切り(中身に現れない字を使う)。
 *
 * **エスケープ表記で書く。** 生の 1 バイトを埋めると git がこのファイルをバイナリと判定して
 * diff を 1 行も見せない(束 ㉔ で実際にレビューできなくなった)。意味は同じ 1 文字であり、
 * 執行は `layer/no-raw-control-char`(`@kaninabe/lint-config`)が見る。
 */
export const KEY_SEPARATOR = '\u0000';

/**
 * 鍵を組み立てる。
 *
 * @param parts 鍵の部品(順序に意味がある)
 * @returns 区切り字で連結した鍵
 */
export function factKey(...parts: readonly (string | number | null)[]): string {
  return parts.map((part) => (part === null ? '' : String(part))).join(KEY_SEPARATOR);
}

/** 鍵を部品に戻す。 */
export function keyParts(key: string): readonly string[] {
  return key.split(KEY_SEPARATOR);
}

/**
 * 集合の差(増えた側・減った側)。中身が並びの軸(見える相手の一覧など)で使う。
 *
 * @param before 基点側の並び
 * @param after 比較先の並び
 * @returns 増えた要素と減った要素(どちらも入力の順)
 */
export function setDelta(
  before: readonly string[],
  after: readonly string[],
): { readonly gained: readonly string[]; readonly lost: readonly string[] } {
  const baseSet = new Set(before);
  const headSet = new Set(after);
  return {
    gained: after.filter((item) => !baseSet.has(item)),
    lost: before.filter((item) => !headSet.has(item)),
  };
}
