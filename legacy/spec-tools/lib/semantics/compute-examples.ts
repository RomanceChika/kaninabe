/**
 * 計算値の例の表(`computes[].examples`)の**意味の導出**。
 *
 * 例の表は「入力 → 値」のデータで、3 か所が同じ読みを使う —— 生成されるユニットテスト・action_spec の
 * `test_cases` の生成ブロック・ブックの早見表(と必読に数える公理の本数)。数え方・並べ方・テストケースの
 * 通し番号・守っている不変条件の引き方をここ 1 か所に置き、読み手ごとに食い違わないようにする。
 *
 * 純粋関数だけ(意味解析の層)。**アプリの語彙は 1 語も持たない。**
 */

import type { LiteralValue } from '../kernel/literal-value.js';
import type { SpecModel } from '../model/types.js';
import type { ActionComputeDecl, ActionComputeExample, ActionSpec } from '../model/trace/types.js';

/** 1 つの操作に置ける例の行数の上限(テストケース ID の連番が 3 桁に収まる範囲。V18 が見る)。 */
export const COMPUTE_EXAMPLE_LIMIT_PER_OPERATION = 99;

/** 例の表を持つ `computes` 1 つ(= 純関数 1 本の例の表)。 */
export interface ComputeExampleSet {
  /** 宣言のある操作(`{machine}.{event}`)。 */
  readonly op: string;
  /** 宣言のある仕様ファイル。 */
  readonly file: string;
  /** specs/backend/actions からの相対パス(生成ブロックを書く先の導出に使う)。 */
  readonly relPath: string;
  readonly decl: ActionComputeDecl;
  /** 例の行(宣言順)。 */
  readonly examples: readonly IndexedExample[];
}

/** 操作の中の通し番号(1 から。テストケース ID の連番になる)を持つ例の行。 */
export interface IndexedExample {
  readonly index: number;
  readonly example: ActionComputeExample;
}

/**
 * 操作の `computes` のうち例の表を持つものを、操作の並び → 宣言順で返す。
 *
 * 通し番号は**操作の中で**宣言順に 1 から振る(複数の `computes` が例を持てば続けて振る)。
 *
 * @param actions action_spec の並び
 */
export function computeExampleSets(actions: readonly ActionSpec[]): ComputeExampleSet[] {
  return actions.flatMap((action) => {
    let next = 1;
    return action.computes.flatMap((decl): ComputeExampleSet[] => {
      if (decl.examples.length === 0) return [];
      const examples = decl.examples.map((example, offset) => ({ index: next + offset, example }));
      next += decl.examples.length;
      return [{ op: action.handles.raw, file: action.location.file, relPath: action.relPath, decl, examples }];
    });
  });
}

/** 例の行の本数(必読に数える公理の本数)。 */
export function computeExampleCount(sets: readonly ComputeExampleSet[]): number {
  return sets.reduce((sum, set) => sum + set.examples.length, 0);
}

/**
 * その純関数(`ref`)を執行点にしている不変条件の ID(宣言順)。
 *
 * 例の表の `test_cases` が守っている仕様 ID の候補である —— 「この関数の値は不変条件の言明どおりである」
 * ことを例が確かめるので、関数を `enforced_by`(kind: application)に宣言した不変条件がそのまま守られる側になる。
 *
 * @param model ドメイン仕様
 * @param ref 純関数の名前
 */
export function invariantsEnforcedBy(model: SpecModel, ref: string): string[] {
  const ids: string[] = [];
  for (const specs of model.aggregates.values()) {
    for (const invariant of specs.invariants?.invariants ?? []) {
      const enforced = invariant.enforcedBy.some((entry) => entry.kind === 'application' && entry.ref === ref);
      if (enforced) ids.push(invariant.id);
    }
  }
  return ids;
}

/**
 * 例の表の `test_cases` が守る仕様 ID(操作そのもの + その関数を執行点にしている不変条件)。
 *
 * @param model ドメイン仕様
 * @param set 例の表
 */
export function computeExampleSpecIds(model: SpecModel, set: ComputeExampleSet): string[] {
  return [set.op, ...invariantsEnforcedBy(model, set.decl.ref)];
}

/** 例の行の鍵(`spec:diff` の事実の表の鍵。先頭が操作なので、章への配り方が操作の機械名で引ける)。 */
export function computeExampleKey(set: ComputeExampleSet, example: ActionComputeExample): string {
  return `${set.op}/${set.decl.ref}/${example.note}`;
}

/** 例の行の鍵から、操作(`{machine}.{event}`)を取り出す(鍵の先頭。操作は `/` を含まない)。 */
export function computeExampleOpOf(key: string): string {
  const slash = key.indexOf('/');
  return slash === -1 ? key : key.slice(0, slash);
}

/** 値を、鍵の並びに依らない 1 本の字面にする(YAML の書き順の入れ替えが差分に化けない)。 */
function canonicalText(value: LiteralValue): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalText(item as LiteralValue)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as { readonly [key: string]: LiteralValue };
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalText(record[key] as LiteralValue)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * 例の行の意味の写し(鍵 → 「入力 → 値」の 1 本の字面)。
 *
 * `spec:diff` が基点の側と比べる元になる(`docs/book/assets/summaries.json`)。行の名前(`note`)は鍵に入り、
 * 中身は入力(`facts_input` では `facts` と `input`、`input` では `input`)と期待値を鍵の順に依らず並べた字面である。
 *
 * @param actions action_spec の並び
 * @returns 例の行ごとの字面(操作の並び → 宣言順)
 */
export function computeExampleTable(actions: readonly ActionSpec[]): Readonly<Record<string, string>> {
  const table: Record<string, string> = {};
  for (const set of computeExampleSets(actions)) {
    for (const { example } of set.examples) {
      const given = set.decl.shape === 'input' ? { input: example.input } : { facts: example.facts, input: example.input };
      table[computeExampleKey(set, example)] = `${canonicalText(given)} → ${canonicalText(example.expect)}`;
    }
  }
  return table;
}
