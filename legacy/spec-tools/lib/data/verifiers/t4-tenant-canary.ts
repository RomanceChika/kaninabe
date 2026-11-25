/**
 * T4 テナント境界の見張りテストの宣言チェック(束 ⑲-2a)。
 *
 * `reads[].filters` は「実行者の属性で行を狭める」宣言だが、**その宣言が実 DB で効いているかは
 * 誰も確かめていない**。束 ⑲-2a の時点で消費先は 3 つ(V2 の接地・権限マトリクスの表・期待 RLS の
 * **ポリシー名**)しかなく、ポリシーの `USING` 句の中身までは縛れなかった —— `..._within_{列}` という
 * 名前のポリシーを置いて `USING (true)` と書けば、宣言は緑・名前の突合も緑・他のテナントの行は全部返る。
 *
 * **束 ⑳-4a で `USING` 句そのものが生成物になった**(`lib/sql/rls-predicate.ts`)。それでもこの見張りテストの宣言は
 * **残す** —— 生成物と実 DB の突合が言えるのは「生成物どおりのポリシーが当たっている」までであり、
 * **そのポリシーで実際に他のテナントの行が返らないか**は行を置いて実行するテストしか言えない
 * (述語の翻訳そのものが間違っていれば、生成物と実 DB は仲良く同じ間違いをする)。したがって必須に
 * するのは**見張りテストの宣言**である —— 宣言 → `@tc` → 「他のテナントの行が 0 件返る」の 3 段で閉じる。
 *
 * **束 ⑳-4b でその宣言も生成物になった。** world を宣言から作れる表では、RLS の挙動テストが
 * `tenantCanaryTestName` そのものの `it` を持ち、data_table の `test_cases` の生成ブロックがその宣言を
 * 書く —— つまり通常は**境界を宣言するだけで 3 段が閉じる**。この検査が鳴るのは**world を宣言から
 * 作れない表**(執行点の条件が宣言から読めない表。理由は T8 が報告する)だけであり、そのときは手書きの
 * 統合テストで宣言を満たす。宣言の置き場は 2 つあり、どちらでもよい。
 *   - 保証台帳(`guarantees.md`)の保証の見張りテスト
 *   - そのテーブルの data_table の `test_cases`
 * どちらも同じテストケース ID 台帳に載るので、この検査は**テスト名 1 つの実在**だけを見る
 * (3 段の突合そのものは Z1 / T3 が既にやっている。ここは「無い」を黙って通さない口である)。
 *
 * 宣言が指すテスト名は**仕様から機械的に決まる**(T3 の突合テストと同じ流儀)。名前を規約にすると、
 * 宣言を足した人がどこに何を書けばよいかを検査のメッセージがそのまま答えられる。
 */

import type { Finding } from '../../kernel/finding.js';
import type { SpecModel } from '../../model/types.js';
import type { TcRegistry } from '../../testcase/types.js';
import { ownerOf } from '../../testcase/index.js';
import type { DataTableSpecModel } from '../../model/data/types.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';
import { tenantCanaryTestName } from '../../messages/messages-rls.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T4';

/** 境界の宣言 1 つ(どのエンティティの、どの表の、どの実行者の欄か)。 */
interface Boundary {
  readonly entity: string;
  readonly table: string;
  readonly actorField: string;
}

/**
 * テナント境界を宣言した reads に、境界の見張りテストの宣言があるかを検証する。
 *
 * テーブル仕様を持たないエンティティは対象外である(宣言の宛先の名前が決まらない)。
 *
 * @param domain 構築済みのドメイン仕様モデル(`reads[].filters` の出どころ)
 * @param dataTables 読み込み済みの data_table(エンティティ → 表名)
 * @param registry テストケース ID 台帳(宣言の母集合。保証台帳の見張りテストも含むが、**製品の持ち物だけ**を数える — 仕組みの台帳のエントリでは満たさない)
 * @returns 違反のリスト
 */
export function verifyTenantCanaries(
  domain: SpecModel,
  dataTables: DataTableSpecModel,
  registry: TcRegistry,
  roots: ProductRoots,
): Finding[] {
  // 製品の境界の見張りは**製品の持ち物**だけが満たす(仕組みの台帳のテスト名が、たまたま同じ綴りで境界の宣言を満たさない)。
  const declared = new Set(
    registry.entries.filter((entry) => ownerOf(entry) === 'product').map((entry) => entry.implementation.testName),
  );
  return boundaries(domain, dataTables)
    .filter((boundary) => !declared.has(tenantCanaryTestName(boundary.table, boundary.actorField)))
    .map((boundary) => missingCanary(boundary, domain, roots));
}

/** 宣言された境界の全体(表名が決まるものだけ・重複なし)。 */
function boundaries(domain: SpecModel, dataTables: DataTableSpecModel): readonly Boundary[] {
  const found: Boundary[] = [];
  for (const specs of domain.aggregates.values()) {
    const access = specs.access;
    if (access === undefined) continue;
    const table = dataTables.tables.find((candidate) => candidate.entity === access.entity)?.table;
    if (table === undefined) continue;
    for (const rule of access.reads) {
      for (const filter of rule.filters ?? []) {
        if (found.some((entry) => entry.table === table && entry.actorField === filter.actorField)) continue;
        found.push({ entity: access.entity, table, actorField: filter.actorField });
      }
    }
  }
  return found;
}

/** 見張りテストの宣言が無い 1 件の Finding。 */
function missingCanary(boundary: Boundary, domain: SpecModel, roots: ProductRoots): Finding {
  const expected = tenantCanaryTestName(boundary.table, boundary.actorField);
  const location = locationOf(domain, boundary.entity, roots);
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message:
      `${boundary.entity} の reads は actor.${boundary.actorField} で境界を宣言していますが、` +
      `他の ${boundary.actorField} の行が返らないことを確かめる見張りテストの宣言がありません`,
    location,
    suggestion:
      `保証台帳(guarantees.md)の保証の見張りテストか、${boundary.table} の data_table の test_cases に、` +
      `"implementation: {テストファイル}::${expected}" を持つ統合テストの宣言を 1 件足してください` +
      '(USING 句そのものは生成物だが、生成物と実 DB の突合が言えるのは「生成物どおりか」まで —— ' +
      '他のテナントの行が返らないことは、行を置いて実行するテストしか言えない)',
    counterexample: {
      entity: boundary.entity,
      table: boundary.table,
      actor_field: boundary.actorField,
      expected_test: expected,
    },
  };
}

/** その集約の access_spec の位置(無ければモデルのどこかを指さずファイルだけ)。 */
function locationOf(domain: SpecModel, entity: string, roots: ProductRoots): Finding['location'] {
  for (const specs of domain.aggregates.values()) {
    if (specs.access?.entity === entity) return { ...specs.access.location, pointer: 'reads' };
  }
  return { file: specPath(roots, 'domain', entity, 'access.md') };
}
