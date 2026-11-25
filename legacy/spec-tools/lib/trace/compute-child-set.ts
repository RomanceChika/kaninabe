/**
 * A19 の「子の行の集合」判定 —— 計算の材料が**構造で言える集合**か(束 F-warn-ledger-c2)。
 *
 * 計画の読み取りは 1 集約 1 行である。計算(`computes`)の材料に宣言した集約が計画から読めないとき、
 * 多くは「1 行に絞る手がかりが無い」だけで、製品が `context` を 1 行足せば直せる(error)。
 * **直せない**のは、その集約が対象の行に対して**複数行ありうる**(子の集合)ときだけである。
 * ここは「複数行ありうる」と**構造で言える場合だけ**を true にする。言えなければ false(= error のまま)。
 *
 * ## 子の集合と言える 3 条件(すべて満たすときだけ)
 *
 * | 条件 | 満たさないとき |
 * |---|---|
 * | 子が対象を親として参照する(子の `context` のキー・または子の欄の `ref`) | 親子ではない |
 * | **対象の側に子への道が無い**(対象の欄の `ref` も `context` のキーも子を指さない) | 道が実在する。1 行に絞れる(`context` を足す等で製品が直せる) |
 * | 子の親への参照が**一意ではない**(`uniqueness` の不変条件・data_table の一意索引・**主キーそのもの**) | 1:1 は集合ではなく 1 行 |
 *
 * **自己参照**(木構造。対象と子が同じ集約)は 2 つ目の条件が落とす —— 自分を指す子は、必ず対象の側にも
 * 自分への道を持つので、専用の場合分けは要らない。
 *
 * 一意の判定は保守側に倒す: 鍵が**参照の欄 1 本だけ**で、限定条件(`where`)が無いときだけ「一意」と読む。
 * 部分一意や複合の鍵は「親 1 行に対して子が複数行ありうる」ので集合のままである。
 * **参照の欄が主キーそのもの**(子の `id` が親の行を指す。子の id = 親の id)なら、主キーは表の全行で一意なので、
 * 一意の不変条件や一意索引を宣言しなくても 1:1 である(宣言は要らない —— 主キーが保証する)。
 */

import type { EntitySpec, SpecModel } from '../model/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';

/** 主キーの列名(全表で `id` 固定。`lib/sql/ddl-plan.ts` の `KEY_COLUMN` と同じ規約。検査から DB 側の部品への辺を増やさないため値を写している)。 */
const PRIMARY_KEY_COLUMN = 'id';

/**
 * 読む欄の集約(`child`)が、対象の集約(`parent`)を親とする**子の行の集合**と構造で言えるか。
 *
 * 名前は集約ディレクトリ名・エンティティ名のどちらでも引く。引けなければ false。
 *
 * @param domain ドメイン仕様
 * @param dataTables data_table(一意索引を引く。無ければ不変条件だけで判定する)
 * @param parent 計算が値を決める欄の集約(対象)
 * @param child 材料として読む欄の集約
 * @returns 子の集合なら true(warning にしてよい)。それ以外は false(error のまま)
 */
export function isChildSetRead(
  domain: SpecModel,
  dataTables: DataTableSpecModel | undefined,
  parent: string,
  child: string,
): boolean {
  const parentSpec = findEntitySpec(domain, parent);
  const childSpec = findEntitySpec(domain, child);
  if (parentSpec === null || childSpec === null) return false;
  const columns = referencingColumns(domain, childSpec, parentSpec);
  if (columns.length === 0) return false; // 子ではない
  if (hasPathTo(domain, parentSpec, childSpec)) return false; // 対象の側に道がある(自己参照もここで落ちる)
  return !columns.some((column) => isUniqueColumn(domain, dataTables, childSpec, column));
}

/** 子の欄のうち、親を指すもの(`ref(親)` の欄と、`context` が親へ辿る参照列)。重複は畳む。 */
function referencingColumns(domain: SpecModel, child: EntitySpec, parent: EntitySpec): readonly string[] {
  const isParent = (name: string): boolean => findEntitySpec(domain, name) === parent;
  const fromRefs = child.fields.filter((field) => field.type.kind === 'ref' && isParent(field.type.entity));
  const fromContext = Object.entries(child.context)
    .filter(([target]) => isParent(target))
    .map(([, path]) => path.split('.')[1])
    .filter((name): name is string => name !== undefined && name !== '');
  return [...new Set([...fromRefs.map((field) => field.name), ...fromContext])];
}

/** 対象の側から子へ辿る道(対象の欄の `ref(子)`・対象の `context` の子へのキー)が宣言されているか。 */
function hasPathTo(domain: SpecModel, parent: EntitySpec, child: EntitySpec): boolean {
  const isChild = (name: string): boolean => findEntitySpec(domain, name) === child;
  return (
    parent.fields.some((field) => field.type.kind === 'ref' && isChild(field.type.entity)) ||
    Object.keys(parent.context).some(isChild)
  );
}

/**
 * 子の 1 欄が**一意**か(親 1 行に対して子が高々 1 行 = 1:1)。
 *
 * 不変条件の `uniqueness`(鍵がその欄 1 本・`where` 無し)か、data_table の一意索引(同じ形)があれば一意。
 * その欄が**主キーの列そのもの**(`id`)なら、宣言が無くても一意である(主キーが保証する)。
 */
function isUniqueColumn(
  domain: SpecModel,
  dataTables: DataTableSpecModel | undefined,
  child: EntitySpec,
  column: string,
): boolean {
  return column === PRIMARY_KEY_COLUMN || uniqueByInvariant(domain, child, column) || uniqueByIndex(dataTables, child, column);
}

/** 子の集約の不変条件に、鍵がその欄だけの限定なしの `uniqueness` があるか。 */
function uniqueByInvariant(domain: SpecModel, child: EntitySpec, column: string): boolean {
  for (const specs of domain.aggregates.values()) {
    if (specs.entity !== child) continue;
    return (specs.invariants?.invariants ?? []).some(
      ({ formal }) =>
        formal?.kind === 'uniqueness' &&
        formal.where === undefined &&
        formal.keys.length === 1 &&
        formal.keys[0] === column,
    );
  }
  return false;
}

/** 子の集約の表に、キーがその列だけの部分でない一意索引があるか。 */
function uniqueByIndex(dataTables: DataTableSpecModel | undefined, child: EntitySpec, column: string): boolean {
  return (dataTables?.tables ?? []).some(
    (table) =>
      table.entity === child.entity &&
      table.indexes.some(
        (index) => index.unique && index.where === undefined && index.on.length === 1 && index.on[0] === column,
      ),
  );
}
