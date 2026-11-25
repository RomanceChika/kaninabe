/**
 * 保存点の**入力の要約(`resend_digests`)が誰を覆うか**の唯一の導出(点検 24 回目 O24-1。原則 8 の 1 か所化)。
 *
 * 要約は保存点の入力 —— 錨の行と、手順が作る子の行 —— から作る。だから要約が覆う人は、その行の**本人の表を指す列**に載る人である。
 * 読み手は 2 つで、どちらもここを呼ぶだけ:
 *
 * - 消去の本文の期待(`digestAnchorsOf` → `generate/render/code-rpc-digest-anchors.ts` → 製品の erase-parity)。手順が作る表は保存点の計画から分かる
 * - T24(`data/verifiers/t24-personal-copy-erasure.ts` の錨の列の道)。保存点を計画に起こさないので、手順が作る表を「錨を指す表の全部」と広く取る
 *   (覆う人を少なく数えない側。期待の側の枝は T24 の道の部分集合になる)
 *
 * 枝の形は 4 つ(参照は 1 段。`refs` は呼び手が渡す —— 期待の側は data_table の外部キー、T24 は ref の宣言):
 *
 * | 種類 | 本人を指す列の置き場 | 例 |
 * |---|---|---|
 * | `anchor` | 錨の表 | 枠主・発行者・主催者 |
 * | `reverse` | 本人の表(錨の表を指す。逆向き) | 本人を生んだ招待 |
 * | `child` | 手順が作る子の表(錨を指す) | 同行の参加者 |
 * | `record` | 手順が作らないが、錨と子の行を指す表 | 紐づけが外れた参加者の記録 |
 *
 * 2 段の参照(子の行 → 中間の表 → 本人)は数えない —— 中間の表の人は要約の入力に名指されない。数え方を変えるときは、ここ 1 か所を変えれば両方の読み手が揃う。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DataTableSpec } from '../model/data/types.js';
import type { DigestSave } from './resend-policy.js';

/**
 * 消去の本文が、要約の錨の id を集める union に持つべき枝 1 本(`from` の表の `column` が本人を指す)。
 * `reverse` は逆向き(本人の表の `column` が錨の表 `from` を指す。本文は本人の行の列を読んでから錨の id と比べる。点検 24 回目 A24-2)。
 */
export interface DigestAnchorBranch {
  readonly from: string;
  readonly column: string;
  readonly reverse?: true;
  /**
   * 枝が select すべき、錨の id を指す `from` の列(点検 25 回目 A25-3)。錨・逆向きの枝は錨の行そのものなので `id`、子・記録の枝は
   * 錨の表を指す列(最初の 1 本)。消去は錨の id で要約を引くので、別の列を集めるとその道の人の要約に届かない。
   */
  readonly up: string;
}

/** 要約が覆う人へ届く枝 1 本(種類つき)。 */
export interface DigestCoverBranch extends DigestAnchorBranch {
  readonly kind: 'anchor' | 'reverse' | 'child' | 'record';
}

/** `table` の列のうち `target` の表を指すもの(参照は 1 段)。 */
export type TableRefs = (table: string, target: string) => readonly string[];

/**
 * 錨 1 つの要約が覆う人へ届く枝の全部(枝の並びは 錨の表 → 逆向き → 子の表(`created` の順)→ 記録の表(`tables` の順))。
 *
 * @param anchor 錨の表
 * @param created 保存点の手順が作る表(錨を含む)。`null` は「分からない」で、錨を指す表の全部を子とみなす
 * @param tables 全表の名前
 * @param home 本人の表
 * @param refs 参照の読み
 * @returns 枝
 */
export function digestCoverOf(anchor: string, created: readonly string[] | null, tables: readonly string[], home: string, refs: TableRefs): readonly DigestCoverBranch[] {
  const linked = (table: string): boolean => table !== anchor && refs(table, anchor).length > 0 && refs(table, home).length > 0;
  const children = (created ?? tables).filter(linked);
  const records = created === null ? [] : tables.filter((table) => !created.includes(table) && linked(table) && children.some((child) => refs(table, child).length > 0));
  const below = (kind: 'child' | 'record') => (from: string) => refs(from, home).map((column) => ({ from, column, kind, up: refs(from, anchor)[0] ?? '' }));
  return [
    ...refs(anchor, home).map((column) => ({ from: anchor, column, kind: 'anchor' as const, up: 'id' })),
    ...refs(home, anchor).map((column) => ({ from: anchor, column, reverse: true as const, kind: 'reverse' as const, up: 'id' })),
    ...children.flatMap(below('child')),
    ...records.flatMap(below('record')),
  ];
}

/** 消去の本文の、要約の錨 1 つ分の期待(点検 23 回目 A23-2 / A23-4)。 */
export interface DigestAnchor {
  readonly event: string;
  readonly table: string;
  /** 錨の id を本人から集める枝(どれか 1 本でも欠けると、その道で覆われた人の要約に消去が届かない)。 */
  readonly branches: readonly DigestAnchorBranch[];
  /** 錨の行が作った後に消えうるか(`semantics/row-removal.ts`)。消えうるなら、消去は錨の無い要約も消す(錨が消えると道も消える)。 */
  readonly removable: boolean;
}

/**
 * data_table の外部キーの参照の読み。
 *
 * @param tables 全 data_table
 * @returns 参照の読み
 */
export function foreignKeyRefs(tables: readonly Pick<DataTableSpec, 'table' | 'foreignKeys'>[]): TableRefs {
  return (table, target) => (tables.find((candidate) => candidate.table === table)?.foreignKeys ?? []).filter((key) => key.references === target).map((key) => key.column);
}

/**
 * 要約を残す保存点ごとに、消去の本文が要約に届くための期待を導く(点検 23 回目 A23-4。錨の表の集合は保存点の宣言から決まる)。
 * 枝は data_table の外部キーだけから `digestCoverOf` で閉じて決める(手順が作らない表の参照は数えない)。
 *
 * @param saves 要約を残す保存点
 * @param tables 全 data_table
 * @param home 本人の表
 * @param removable 表の行が作った後に消えうるか
 * @returns 錨ごとの期待(event の辞書順)
 */
export function digestAnchorsOf(
  saves: readonly DigestSave[],
  tables: readonly Pick<DataTableSpec, 'table' | 'foreignKeys'>[],
  home: string,
  removable: (table: string) => boolean,
): readonly DigestAnchor[] {
  const refs = foreignKeyRefs(tables);
  const names = tables.map((table) => table.table);
  return [...saves]
    .sort((a, b) => a.event.localeCompare(b.event))
    .map((save) => ({
      event: save.event,
      table: save.anchor,
      branches: digestCoverOf(save.anchor, save.created, names, home, refs).map(({ from, column, reverse, up }) => ({ from, column, ...(reverse === true ? { reverse } : {}), up })),
      removable: removable(save.anchor),
    }));
}
