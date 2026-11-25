/**
 * SpecModel からガード式の変数ドメイン宣言(DomainEnv)を構築する。
 *
 * 充足性判定(V9)と決定性判定(V8)は「そのパスが取り得る値の集合」を知って初めて
 * 決定可能になる。ここはその写像だけを担う純粋モジュールであり、
 * ガード式のパース・評価そのものには関与しない。
 *
 * ドメインの割り当て規則(domain-spec-writing.md §ガード式の文法):
 * - `state(machine)` → その状態機械の states を全列挙した finite
 * - `enum([...])`    → 宣言値を全列挙した finite
 * - `boolean`        → finite ["true", "false"]
 * - `integer`        → ordered(discrete)。離散なので `n > 1 and n < 2` を恒偽と判定できる
 * - `decimal` / 日付 / 予約語 `now` → ordered(連続扱い。リテラルとの区間比較のみ)
 * - `uuid` / `ref(entity)` / 文字列 → opaque(等号比較のみ)
 */

import type { SpecModel, FieldType } from '../model/types.js';
import {
  collectMachineStates,
  finiteValuesOfField,
  valueKindOfFieldType,
  type ValueKind,
} from '../model/field-values.js';
import type { ValueKindEnv } from '../guard/comparison-typing.js';
import type { DomainEnv, VariableDomain } from '../guard/ast.js';

/** 予約語 `now` のパス文字列。現在時刻は順序付き不透明値として扱う。 */
export const NOW_PATH = 'now';

/** 実行者を指すパス。`actor.id` は等号比較にしか使えないので opaque。 */
export const ACTOR_ID_PATH = 'actor.id';

/** 実行者を指す予約語のルート。 */
const ACTOR_ROOT = 'actor';

/**
 * フィールド型を変数ドメインへ写す。
 *
 * 有限集合(state / enum / boolean)の値域そのものは lib/model/field-values.ts が正であり、
 * ここはそれを VariableDomain へ包むだけである。参照先の状態機械が未定義の場合
 * (V2 が別途エラーにする)は、判定を保守的に保つため opaque(等号比較のみの不透明値)へ
 * フォールバックする。
 *
 * @param type entity_spec のフィールド型
 * @param machineStates 機械名 → 状態一覧(collectMachineStates の結果)
 * @returns そのフィールドが取り得る値のドメイン
 */
export function domainOfFieldType(
  type: FieldType,
  machineStates: ReadonlyMap<string, readonly string[]>,
): VariableDomain {
  const values = finiteValuesOfField(type, machineStates);
  if (values !== null) return { kind: 'finite', values };
  switch (type.kind) {
    case 'integer':
      return { kind: 'ordered', discrete: true };
    case 'decimal':
    case 'date':
    case 'datetime':
      return { kind: 'ordered' };
    default:
      return { kind: 'opaque' };
  }
}

/**
 * モデル全体のドメイン環境を作る。キーは `{エンティティ名}.{フィールド名}` 形式。
 *
 * ガード式は他集約のフィールド(`workshop.state` 等)を参照してよいため、
 * 環境は常にモデル全体から作る。集約ディレクトリ名とエンティティ名が食い違う場合に備え、
 * 両方のプレフィックスで登録する。
 *
 * @param model 検証対象のドメイン仕様全体
 * @returns パス文字列 → 変数ドメインのマップ
 */
export function buildDomainEnv(model: SpecModel): DomainEnv {
  const machineStates = collectMachineStates(model);
  return buildFieldEnv(model, (type) => domainOfFieldType(type, machineStates), {
    [NOW_PATH]: { kind: 'ordered' },
    [ACTOR_ID_PATH]: { kind: 'opaque' },
  });
}

/**
 * モデル全体の「パス → 値の種別」を作る(比較の型一致を見る V2 用)。
 *
 * 変数ドメイン(充足性判定の材料)とはキーの作り方が同じで値だけが違うので、走査は
 * `buildFieldEnv` に寄せる —— 同じ前置きの規則を 2 つ書くと片方だけが直る。
 *
 * @param model 検証対象のドメイン仕様全体
 * @returns パス文字列 → 値の種別のマップ
 */
export function buildValueKindEnv(model: SpecModel): ValueKindEnv {
  const env = new Map<string, ValueKind>(
    buildFieldEnv(model, valueKindOfFieldType, {
      [NOW_PATH]: 'datetime',
      [ACTOR_ID_PATH]: 'opaque',
    }),
  );
  // 実行者の属性(`actor.{欄}`)はセッションに載る欄だけが書ける(path-resolve.ts が正)。
  // 種別はその欄を持つエンティティの宣言そのものなので、同じ写像をもう 1 つのキーで引けるようにする。
  for (const specs of model.aggregates.values()) {
    for (const field of specs.entity?.fields ?? []) {
      if (field.session === true) env.set(`${ACTOR_ROOT}.${field.name}`, valueKindOfFieldType(field.type));
    }
  }
  return env;
}

/**
 * 特定の集約から見た「パス → 値の種別」(裸のフィールド名を含む)。
 *
 * @param model 検証対象のドメイン仕様全体
 * @param aggregateName 基準となる集約名
 * @returns パス文字列 → 値の種別のマップ
 */
export function buildAggregateValueKindEnv(model: SpecModel, aggregateName: string): ValueKindEnv {
  return overlayBareFields(model, aggregateName, buildValueKindEnv(model), valueKindOfFieldType);
}

/**
 * エンティティのフィールドを `{エンティティ名}.{欄}` / `{集約名}.{欄}` の 2 通りで引ける
 * マップに畳む共通部(値の作り方だけを差し替える)。
 *
 * @param model ドメイン仕様全体
 * @param of フィールド型 → 値
 * @param reserved 予約語(`now` / `actor.id`)の値
 * @returns パス文字列 → 値のマップ
 */
function buildFieldEnv<T>(
  model: SpecModel,
  of: (type: FieldType) => T,
  reserved: Readonly<Record<string, T>>,
): ReadonlyMap<string, T> {
  const env = new Map<string, T>(Object.entries(reserved));
  for (const [aggregateName, specs] of model.aggregates) {
    const entity = specs.entity;
    if (entity === undefined) continue;
    const prefixes = new Set<string>([entity.entity, aggregateName]);
    for (const field of entity.fields) {
      const value = of(field.type);
      for (const prefix of prefixes) env.set(`${prefix}.${field.name}`, value);
    }
  }
  return env;
}

/** 自集約のフィールド名(裸)を重ねる(`when: state == draft` の形)。 */
function overlayBareFields<T>(
  model: SpecModel,
  aggregateName: string,
  base: ReadonlyMap<string, T>,
  of: (type: FieldType) => T,
): ReadonlyMap<string, T> {
  const entity = model.aggregates.get(aggregateName)?.entity;
  if (entity === undefined) return base;
  const env = new Map<string, T>(base);
  for (const field of entity.fields) env.set(field.name, of(field.type));
  return env;
}

/**
 * 特定の集約から見たドメイン環境を作る。
 *
 * `when: state == draft` のように、自集約のフィールドはプレフィックス無しで書けるため、
 * モデル全体の環境に「自エンティティのフィールド名(裸)」を重ねたものを返す。
 *
 * @param model 検証対象のドメイン仕様全体
 * @param aggregateName 基準となる集約名(SpecModel.aggregates のキー)
 * @returns パス文字列 → 変数ドメインのマップ(裸のフィールド名を含む)
 */
export function buildAggregateEnv(model: SpecModel, aggregateName: string): DomainEnv {
  const machineStates = collectMachineStates(model);
  return overlayBareFields(model, aggregateName, buildDomainEnv(model), (type) =>
    domainOfFieldType(type, machineStates),
  );
}
