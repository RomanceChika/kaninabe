/**
 * T1 テーブル仕様 ⇔ ドメイン仕様の一貫性チェック。
 *
 * ARCH-SP-BE-0001 §テーブル仕様の要求:
 *   - data_table の `entity` は実在する entity_spec を指すこと
 *   - `table` は entity_spec から規則(複数形化 + `table:` 上書き)で導いた名前と一致すること
 *   - 同じテーブル・同じエンティティを 2 ファイルが宣言しないこと
 *   - entity_spec があるのに data_table が無い状態を残さないこと(specs 側の閉世界)
 *   - 状態の欄を `defaults` に書かないこと(初期状態の正は state_spec の `initial` の 1 か所。`t1-state-default.ts`)
 *   - トリガが指す関数は同じファイルの functions に kind: trigger で帰属していること
 *   - 関数の帰属はリポジトリ全体で 1 意であること(閉世界の割り当てが割れない)
 *   - `kind: rpc` は `params`(引数名)を args と同じ長さで宣言し、名前が `p_` で始まる
 *     snake_case で重複しないこと(束 ⑯c。複合 RPC の生成が名前から意味を決めるため)
 *
 * 実 DB との突合(過不足の両方向)は統合テスト
 * `app/src/infrastructure/__tests__/schema/data-table-parity.test.ts` が担う。
 */

import type { SpecModel } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import { pluralizeEntity } from '../../model/table-name.js';
import { checkStateDefaults } from './t1-state-default.js';
import type { DataTableSpec, DataTableSpecModel } from '../../model/data/types.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'T1';

/** T1 の指摘を組み立てる(severity は既定 error)。 */
function t1Finding(args: Omit<Finding, 'verifier' | 'severity'> & { severity?: Finding['severity'] }): Finding {
  return { verifier: VERIFIER_ID, severity: args.severity ?? 'error', ...args };
}

/**
 * data_table とドメイン仕様の一貫性を検証する。
 *
 * @param domain 構築済みのドメイン仕様モデル(entity_spec の台帳)
 * @param dataTables 読み込み済みの data_table
 * @returns 違反のリスト
 */
export function verifyEntityConsistency(
  domain: SpecModel,
  dataTables: DataTableSpecModel,
  roots: ProductRoots,
): Finding[] {
  const entities = entityTables(domain);
  const findings: Finding[] = [];

  findings.push(...checkDuplicates(dataTables));
  for (const spec of dataTables.tables) findings.push(...checkTable(spec, entities), ...checkStateDefaults(spec, domain, VERIFIER_ID));
  findings.push(...checkCoverage(domain, dataTables, entities, roots));
  return findings;
}

/** entity_spec から「エンティティ名 → 期待テーブル名」の対応を作る(規則 + `table:` 上書き)。 */
function entityTables(domain: SpecModel): ReadonlyMap<string, string> {
  const tables = new Map<string, string>();
  for (const specs of domain.aggregates.values()) {
    const entity = specs.entity;
    if (entity === undefined) continue;
    tables.set(entity.entity, entity.table ?? pluralizeEntity(entity.entity));
  }
  return tables;
}

/** 1 つの data_table を entity_spec の台帳と突き合わせる。 */
function checkTable(spec: DataTableSpec, entities: ReadonlyMap<string, string>): Finding[] {
  const findings: Finding[] = [];
  if (spec.entity !== undefined) {
    const expected = entities.get(spec.entity);
    if (expected === undefined) {
      findings.push(
        t1Finding({
          message: `entity ${spec.entity} に対応する entity_spec がありません`,
          location: { ...spec.location, pointer: 'entity' },
          suggestion:
            'specs/domain/{aggregate}/entity.md の entity と一致させる(綴りの確認は ' +
            '`grep -rl "entity: {名前}" docs/specs/domain`)。ドメイン仕様に無い台帳なら internal: true にする',
          counterexample: { entity: spec.entity },
        }),
      );
    } else if (expected !== spec.table) {
      findings.push(
        t1Finding({
          message:
            `table ${spec.table} が entity_spec から導かれるテーブル名(${expected})と一致しません`,
          location: { ...spec.location, pointer: 'table' },
          suggestion:
            `table: ${expected} に直す。DB 側の実名が本当に ${spec.table} なら、正は entity_spec の ` +
            '`table:` 上書きであり、そちらに宣言してからここを合わせる(ARCH-SP-BE-0001 の命名規約)',
          counterexample: { table: spec.table, expected, entity: spec.entity },
        }),
      );
    }
  }
  for (const fn of spec.functions) findings.push(...checkParams(spec, fn));
  for (const trigger of spec.triggers) {
    const declared = spec.functions.find((fn) => fn.name === trigger.functionName);
    if (declared === undefined || declared.kind !== 'trigger') {
      findings.push(
        t1Finding({
          message:
            `トリガ ${trigger.name} の関数 ${trigger.functionName} が、このファイルの functions に ` +
            'kind: trigger で帰属していません',
          location: { ...spec.location, pointer: `triggers.${trigger.name}` },
          suggestion:
            `functions に "- name: ${trigger.functionName} / args: [] / kind: trigger" を足す` +
            '(関数の閉世界はこの帰属宣言の和集合であり、トリガ関数も 1 つの表に帰属させる)',
          counterexample: { trigger: trigger.name, function: trigger.functionName },
        }),
      );
    }
  }
  return findings;
}

/** 引数名(`p_` で始まる snake_case)。複合 RPC の生成器はこの形の名前からしか意味を読まない。 */
const PARAM_NAME = /^p_[a-z_]+$/;

/**
 * `kind: rpc` の `params`(引数名)を見る。
 *
 * 長さが `args` と一致すること・名前が `^p_[a-z_]+$` であること・重複が無いこと。
 * 名前は複合 RPC の生成(束 ⑯c)で「その引数に何を渡すか」を決める唯一の手がかりなので、
 * 形が崩れると生成が黙って別の意味に流れる。実 DB の `pg_proc.proargnames` との突合は
 * 統合テスト(rpc-signatures-parity)が担う。
 */
function checkParams(spec: DataTableSpec, fn: DataTableSpec['functions'][number]): Finding[] {
  if (fn.kind !== 'rpc') return [];
  const pointer = `functions.${fn.name}.params`;
  const location = { ...spec.location, pointer };
  if (fn.params.length !== fn.args.length) {
    return [
      t1Finding({
        message: `${fn.name} の params(${fn.params.length} 件)が args(${fn.args.length} 件)と同じ長さではありません`,
        location,
        suggestion:
          `migration の create function に書いてある引数名を、args と同じ順で ${fn.args.length} 件並べる` +
          '(名前は仕様の宣言であり、実 DB の proargnames と rpc-signatures-parity が突き合わせる)',
        counterexample: { function: fn.name, params: String(fn.params.length), args: String(fn.args.length) },
      }),
    ];
  }
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const param of fn.params) {
    if (!PARAM_NAME.test(param)) {
      findings.push(
        t1Finding({
          message: `${fn.name} の引数名 ${param} が p_ で始まる snake_case ではありません`,
          location,
          suggestion: '引数名は p_ を前置した snake_case で書く(複合 RPC の生成器が名前から供給元を決める)',
          counterexample: { function: fn.name, param },
        }),
      );
    }
    if (seen.has(param)) {
      findings.push(
        t1Finding({
          message: `${fn.name} の引数名 ${param} が重複しています`,
          location,
          suggestion: '同じ名前の引数は 2 つ書けない(名前付き呼び出しでどちらを指すか決まらない)。実際の引数名に直す',
          counterexample: { function: fn.name, param },
        }),
      );
    }
    seen.add(param);
  }
  return findings;
}

/** テーブル・エンティティ・関数の重複宣言(閉世界の割り当てが 1 意でなくなるもの)を検出する。 */
function checkDuplicates(dataTables: DataTableSpecModel): Finding[] {
  const findings: Finding[] = [];
  const byKey = new Map<string, DataTableSpec>();
  const functionOwner = new Map<string, DataTableSpec>();
  for (const spec of dataTables.tables) {
    for (const [kind, value] of [
      ['table', spec.table],
      ['entity', spec.entity],
    ] as const) {
      if (value === undefined) continue;
      const key = `${kind}:${value}`;
      const first = byKey.get(key);
      if (first === undefined) {
        byKey.set(key, spec);
        continue;
      }
      findings.push(
        t1Finding({
          message: `${kind} ${value} が ${first.location.file} と二重に宣言されています`,
          location: { ...spec.location, pointer: kind },
          suggestion: '1 テーブル 1 ファイルにする。重複した側を削除するか、宣言を正しい値に直す',
          counterexample: { [kind]: value, first: first.location.file },
        }),
      );
    }
    for (const fn of spec.functions) {
      const owner = functionOwner.get(fn.name);
      if (owner === undefined) {
        functionOwner.set(fn.name, spec);
        continue;
      }
      findings.push(
        t1Finding({
          message: `関数 ${fn.name} が ${owner.location.file} と二重に帰属しています`,
          location: { ...spec.location, pointer: `functions.${fn.name}` },
          suggestion: '関数の持ち場は 1 テーブルに決める(主に書く・守る対象の表に寄せ、もう片方を削除する)',
          counterexample: { function: fn.name, first: owner.location.file },
        }),
      );
    }
  }
  return findings;
}

/** entity_spec があるのに data_table が無い欠落(specs 側の閉世界)を検出する。 */
function checkCoverage(
  domain: SpecModel,
  dataTables: DataTableSpecModel,
  entities: ReadonlyMap<string, string>,
  roots: ProductRoots,
): Finding[] {
  const declared = new Set(
    dataTables.tables.map((spec) => spec.entity).filter((entity): entity is string => entity !== undefined),
  );
  const findings: Finding[] = [];
  for (const specs of domain.aggregates.values()) {
    const entity = specs.entity;
    if (entity === undefined || declared.has(entity.entity)) continue;
    const table = entities.get(entity.entity) ?? pluralizeEntity(entity.entity);
    findings.push(
      t1Finding({
        message: `entity_spec ${entity.entity} に対応する data_table がありません`,
        location: entity.location,
        suggestion:
          `${specPath(roots, 'backend/data/tables', `${table}.md`)} を template.data_table.md から作る` +
          '(テーブルの物理実装判断が specs の外に残ると、引き継ぎで DB を再現できない)',
        counterexample: { entity: entity.entity, expected: `${table}.md` },
      }),
    );
  }
  return findings;
}
