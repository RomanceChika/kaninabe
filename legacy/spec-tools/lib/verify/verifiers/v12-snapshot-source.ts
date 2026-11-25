/**
 * V12(スナップショット写像)のうち、写像元(`from`)の解決だけを持つ。
 *
 * `v12-snapshot-mapping.ts` が呼ぶ。観点③(写像元の実在)の判定はここに集約する。
 */

import type { EntitySpec, FieldDef, FieldType, SnapshotFieldMap } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** この検証器の ID(finding の組み立てに使う)。 */
const VERIFIER_ID = 'V12';

/** 写像元に書ける予約語。「この写しを作った時刻」を表し、型は datetime。 */
export const NOW = 'now';

/** V12 の指摘を組み立てる。 */
function finding(severity: Finding['severity'], args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity, ...args };
}

/**
 * 型を比較可能な文字列に正規化する。
 *
 * `ref(X)` は列としては uuid であり、写しの側が `ref` で受けても `uuid` で受けても同じものが入る。
 * enum は**値の集合が一致すること**まで見る(片方に値を足したら写像は成り立たない)。
 */
export function normalizeType(type: FieldType): string {
  switch (type.kind) {
    case 'ref':
      return 'uuid';
    case 'enum':
      return `enum(${[...type.values].sort((a, b) => a.localeCompare(b)).join(',')})`;
    case 'state':
      return `state(${type.machine})`;
    default:
      return type.kind;
  }
}

/** 値がシステムから供給されるフィールドか(採番・既定値。写像元としては常に値がある)。 */
function suppliesValue(field: FieldDef): boolean {
  return field.auto || field.required || field.type.kind === 'state';
}

/** 写像元 1 件の解決結果。`now` は型だけを持つ。 */
export interface Source {
  readonly type: string;
  /** 値が必ず入るか(必須または auto)。写像先が required のときに要る。 */
  readonly always: boolean;
}

/**
 * 写像元(`from`)を解決する。実在しなければ違反を記録して null を返す(観点③)。
 *
 * @param map 写像 1 行
 * @param context どこの宣言かを表す文字列(メッセージに埋める)
 * @param entities エンティティ索引
 * @param roots 製品が宣言した根(道案内のパスを組み立てる)
 */
export function resolveSource(
  map: SnapshotFieldMap,
  context: string,
  entities: ReadonlyMap<string, EntitySpec>,
  roots: ProductRoots,
): { source: Source | null; findings: Finding[] } {
  if (map.from === NOW) return { source: { type: 'datetime', always: true }, findings: [] };

  const segments = map.from.split('.');
  const [entityName, fieldName] = segments;
  if (segments.length !== 2 || entityName === undefined || fieldName === undefined) {
    return {
      source: null,
      findings: [
        finding('error', {
          message: `${context} の写像元 "${map.from}" が "{entity}.{field}" の形ではありません`,
          location: map.location,
          suggestion: `写像元は "{エンティティ名}.{フィールド名}" の 2 段で書く(この写しを作った時刻なら予約語 ${NOW})`,
          counterexample: { from: map.from, to: map.to },
        }),
      ],
    };
  }

  const entity = entities.get(entityName);
  if (entity === undefined) {
    return {
      source: null,
      findings: [
        finding('error', {
          message: `${context} の写像元のエンティティ ${entityName} が実在しません`,
          location: map.location,
          suggestion: `${specPath(roots, 'domain/{集約}/entity.md')} に entity: ${entityName} があるか確かめる(綴り違いを直す)`,
          counterexample: { from: map.from, missing_entity: entityName },
        }),
      ],
    };
  }

  const field = entity.fields.find((candidate) => candidate.name === fieldName);
  if (field === undefined) {
    return {
      source: null,
      findings: [
        finding('error', {
          message: `${context} の写像元 ${map.from} の列 ${fieldName} が ${entityName} にありません`,
          location: map.location,
          suggestion: `${entityName} の entity_spec にある列名へ直すか、写像の行を消す(元の列を消したなら写しの列も要らないはず)`,
          counterexample: { from: map.from, entity: entityName, field: fieldName },
        }),
      ],
    };
  }
  return { source: { type: normalizeType(field.type), always: suppliesValue(field) }, findings: [] };
}
