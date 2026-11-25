/**
 * V18 の下位検査 — 計算値の例の表(`computes[].examples`)の接地。
 *
 * 例の表は「入力 → 値」のデータで、生成されるユニットテストが純関数の実際の値と突き合わせる。
 * 突き合わせの前に、**例そのものが仕様と食い違っていない**ことをここで見る(新しい規則 ID は
 * 増やさず、計算値の接地である V18 の中に置く):
 *
 * - **材料の範囲** … `given.facts` の鍵は、その `computes` が `reads` に並べた事実だけ
 *   (読まない事実を渡しても、関数が実際に読む材料と食い違う例になる)
 * - **入力の実在** … `given.input` の鍵は、その操作の `input` に並ぶ欄だけ
 * - **値の型** … `facts` / `input` / `expect` の値は、その欄の型に従う(数値・真偽・文字列・null)。
 *   `expect` の型は `computes` の `field` の型である(`null` は「列に触れない」を言う)
 * - **重複なし** … 同じ `given` の行を 2 度書かない・`note` は 1 つの `computes` の中で一意
 * - **形の整合** … `shape: input` の関数は事実を受け取らない(`facts` は書けない)。`expect` は
 *   `facts_input` ならその欄の値、`shape: input` なら戻り値の写し
 * - **名前と量** … `note` はテストの名前として YAML の平文に載るので使えない字がある・1 つの操作に置ける
 *   例は 99 行まで(テストケース ID の連番が 3 桁に収まる)
 * - **ref ごとに 1 か所** … 同じ `ref` の欄が複数あるとき、例は 1 つの欄にだけ書く(同じ関数の例を
 *   重ねると、早見表もテストも同じ行を何度も数える)
 *
 * `shape: input` の `input` / `expect` は関数の引数と戻り値の写し(欄の宣言を持たない)ので、
 * 欄との突き合わせは見ない。値が YAML の運べる形であること(パーサーが見る)だけが条件である。
 * 例外が 1 つある: `expect` は部分一致で比べるので、**葉まで 1 値以上を持つ**こと(`{}` や空の入れ子は
 * 何を返しても通る空の例になる。`null` と `[]` は主張を持つ)。
 */

import type { Finding } from '../../kernel/finding.js';
import { valueKindOfFieldType } from '../../model/field-values.js';
import type { FieldDef, SpecModel } from '../../model/types.js';
import { COMPUTE_EXAMPLE_LIMIT_PER_OPERATION } from '../../semantics/compute-examples.js';
import { findEntitySpec } from '../../semantics/domain-lookup.js';
import type { ActionComputeDecl, ActionComputeExample, ActionSpec, ComputeExampleValue } from '../../model/trace/types.js';

/** この検査が属する検証器の ID。 */
const VERIFIER_ID = 'V18';

/** `note` に書けない字(生成する `test_cases` の YAML の平文に載せるため)。 */
const NOTE_FORBIDDEN = /[:#]|^[[{&*!|>'"%@`-]/u;

/** 指摘を組み立てる。 */
function finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** 値が欄の型に合うか(`null` は「空・触れない」なので常に合う)。合わなければ理由を返す。 */
function typeProblem(field: FieldDef, value: ComputeExampleValue): string | null {
  if (value === null) return null;
  const kind = valueKindOfFieldType(field.type);
  if (kind === 'boolean') return typeof value === 'boolean' ? null : '真偽値(true / false)で書く';
  if (kind === 'number') {
    if (typeof value !== 'number') return '数値で書く';
    return field.type.kind === 'integer' && !Number.isInteger(value) ? '整数で書く' : null;
  }
  return typeof value === 'string' ? null : '文字列で書く';
}

/** 値の並びを順序によらない 1 本の文字列にする(重複の判定用)。 */
function canonical(value: ComputeExampleValue): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item as ComputeExampleValue)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as { readonly [key: string]: ComputeExampleValue };
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key] as ComputeExampleValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** 値が主張する葉の数(`[]` は長さ 0 の主張で 1。空のマッピングは 0 = 何を返しても一致する空振り)。 */
function leafCount(value: ComputeExampleValue): number {
  const children =
    Array.isArray(value) && value.length > 0
      ? (value as readonly ComputeExampleValue[])
      : typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.values(value as { readonly [key: string]: ComputeExampleValue })
        : null;
  return children === null ? 1 : children.reduce<number>((sum, item) => sum + leafCount(item), 0);
}

/** `shape: input` の `expect` が何も主張していない(`{}` など。部分一致の比べ方では何を返しても通る)。 */
function checkEmptyExpect(where: Where): Finding[] {
  if (leafCount(where.example.expect) > 0) return [];
  return [
    finding({
      message: `${where.op} の computes(${where.decl.raw})の例「${where.example.note}」の expect が空です(葉まで下っても比べる値が 1 つもありません)`,
      location: where.example.location,
      suggestion:
        'shape: input の expect は書いた鍵だけを部分一致で比べるので、{} や空の入れ子は何を返しても通る。' +
        '早見表に載せたい値を 1 つ以上書く(戻り値が無い・決まらないことを言うなら null)',
      counterexample: { action: where.op, compute: where.decl.raw, note: where.example.note, expect: JSON.stringify(where.example.expect) },
    }),
  ];
}

/** 指摘の場所と反例の共通部分。 */
interface Where {
  readonly op: string;
  readonly decl: ActionComputeDecl;
  readonly example: ActionComputeExample;
}

/** `facts` の 1 件(鍵が reads の範囲内か・値が欄の型か)。 */
function checkFacts(model: SpecModel, where: Where): Finding[] {
  const reads = new Set(where.decl.reads.map((read) => read.raw));
  return Object.entries(where.example.facts).flatMap(([key, value]) => {
    const counterexample = { action: where.op, compute: where.decl.raw, note: where.example.note, fact: key };
    if (!reads.has(key)) {
      return [
        finding({
          message: `${where.op} の computes(${where.decl.raw})の例「${where.example.note}」が渡す事実 ${key} は、その computes の reads に並んでいません`,
          location: where.example.location,
          suggestion:
            '例の facts に書けるのは、その computes が reads に並べた事実だけ(読まない事実を渡すと、' +
            '関数が実際に受け取る材料と食い違う例になる)。reads に足すか、例から外す',
          counterexample,
        }),
      ];
    }
    const [entity = '', name = ''] = key.split('.');
    const field = findEntitySpec(model, entity)?.fields.find((candidate) => candidate.name === name);
    const problem = field === undefined ? null : typeProblem(field, value);
    if (problem === null) return [];
    return [
      finding({
        message: `${where.op} の computes(${where.decl.raw})の例「${where.example.note}」の事実 ${key} の値が欄の型に合いません`,
        location: where.example.location,
        suggestion: `${key} は ${problem}(空を言うなら null)`,
        counterexample: { ...counterexample, value: JSON.stringify(value) },
      }),
    ];
  });
}

/** `input` の 1 件(鍵が操作の input の欄か・値が欄の型か)。 */
function checkInput(model: SpecModel, action: ActionSpec, where: Where): Finding[] {
  return Object.entries(where.example.input).flatMap(([key, value]) => {
    const ref = action.input.find((candidate) => candidate.field === key);
    const counterexample = { action: where.op, compute: where.decl.raw, note: where.example.note, input: key };
    if (ref === undefined) {
      return [
        finding({
          message: `${where.op} の computes(${where.decl.raw})の例「${where.example.note}」の入力 ${key} は、この操作の input にありません`,
          location: where.example.location,
          suggestion: `例の input に書けるのは、操作の input に並ぶ欄(${action.input.map((entry) => entry.field).join(' / ')})だけ`,
          counterexample,
        }),
      ];
    }
    const field = findEntitySpec(model, ref.entity)?.fields.find((candidate) => candidate.name === ref.field);
    const problem = field === undefined ? null : typeProblem(field, value);
    if (problem === null) return [];
    return [
      finding({
        message: `${where.op} の computes(${where.decl.raw})の例「${where.example.note}」の入力 ${key} の値が欄の型に合いません`,
        location: where.example.location,
        suggestion: `${ref.raw} は ${problem}(空を言うなら null)`,
        counterexample: { ...counterexample, value: JSON.stringify(value) },
      }),
    ];
  });
}

/** `expect` が欄の型に合うか。 */
function checkExpect(model: SpecModel, where: Where): Finding[] {
  const field = findEntitySpec(model, where.decl.entity)?.fields.find((candidate) => candidate.name === where.decl.field);
  const problem = field === undefined ? null : typeProblem(field, where.example.expect);
  if (problem === null) return [];
  return [
    finding({
      message: `${where.op} の computes(${where.decl.raw})の例「${where.example.note}」の expect が欄の型に合いません`,
      location: where.example.location,
      suggestion: `${where.decl.raw} は ${problem}(列に触れない = 決まらないことを言うなら null)`,
      counterexample: { action: where.op, compute: where.decl.raw, note: where.example.note, expect: JSON.stringify(where.example.expect) },
    }),
  ];
}

/** 1 つの `computes` の例を全部見る。 */
function checkDecl(model: SpecModel, action: ActionSpec, decl: ActionComputeDecl): Finding[] {
  const op = action.handles.raw;
  const findings: Finding[] = [];
  const notes = new Set<string>();
  const givens = new Set<string>();
  for (const example of decl.examples) {
    const where: Where = { op, decl, example };
    if (notes.has(example.note)) {
      findings.push(
        finding({
          message: `${op} の computes(${decl.raw})の例の note「${example.note}」が重複しています`,
          location: example.location,
          suggestion: 'note は 1 つの computes の中で一意にする(テストの名前と早見表の行の名前になる)',
          counterexample: { action: op, compute: decl.raw, note: example.note },
        }),
      );
    }
    notes.add(example.note);
    if (NOTE_FORBIDDEN.test(example.note)) {
      findings.push(
        finding({
          message: `${op} の computes(${decl.raw})の例の note「${example.note}」に、使えない字があります`,
          location: example.location,
          suggestion:
            'note はテストの名前として test_cases の YAML の平文に載るので、ASCII の : と # を含められず、' +
            '先頭に記号(- [ { & * ! | > \' " % @ `)を置けない(全角の：や言い換えにする)',
          counterexample: { action: op, compute: decl.raw, note: example.note },
        }),
      );
    }
    const key = canonical({ facts: example.facts, input: example.input });
    if (givens.has(key)) {
      findings.push(
        finding({
          message: `${op} の computes(${decl.raw})の例「${example.note}」は、同じ given の行がすでにあります`,
          location: example.location,
          suggestion: '同じ入力の行を 2 度書かない(同じ入力で違う値を言う行は、どちらかが間違っている)',
          counterexample: { action: op, compute: decl.raw, note: example.note },
        }),
      );
    }
    givens.add(key);
    if (decl.shape === 'input') {
      if (Object.keys(example.facts).length > 0) {
        findings.push(
          finding({
            message: `${op} の computes(${decl.raw})は shape: input なので、例に facts は書けません(例「${example.note}」)`,
            location: example.location,
            suggestion: 'shape: input の関数は事実を受け取らない。given は input だけにする(facts を渡す関数なら shape を外す)',
            counterexample: { action: op, compute: decl.raw, note: example.note },
          }),
        );
      }
      findings.push(...checkEmptyExpect(where));
      continue;
    }
    findings.push(...checkFacts(model, where), ...checkInput(model, action, where), ...checkExpect(model, where));
  }
  return findings;
}

/** 同じ ref の欄が複数あるとき、例は 1 つの欄にだけ書く(2 つ目以降を指摘する)。 */
function checkOnePerRef(actions: readonly ActionSpec[]): Finding[] {
  const first = new Map<string, string>();
  const findings: Finding[] = [];
  for (const action of actions) {
    for (const decl of action.computes) {
      if (decl.examples.length === 0) continue;
      const owner = first.get(decl.ref);
      if (owner === undefined) {
        first.set(decl.ref, `${action.handles.raw} の ${decl.raw}`);
        continue;
      }
      findings.push(
        finding({
          message: `${action.handles.raw} の computes(${decl.raw})の例は、同じ ref ${decl.ref} の例が ${owner} にすでにあります`,
          location: decl.examples[0]?.location ?? decl.location,
          suggestion: '同じ関数の例は 1 つの欄にだけ書く(重ねると、テストも早見表も同じ行を何度も数える)',
          counterexample: { action: action.handles.raw, compute: decl.raw, ref: decl.ref },
        }),
      );
    }
  }
  return findings;
}

/** 1 つの操作の例の行数が上限を超えていない(テストケース ID が 900 の帯に届かない)。 */
function checkLimit(action: ActionSpec): Finding[] {
  const total = action.computes.reduce((sum, decl) => sum + decl.examples.length, 0);
  if (total <= COMPUTE_EXAMPLE_LIMIT_PER_OPERATION) return [];
  return [
    finding({
      message: `${action.handles.raw} の例の行が ${total} 本あります(1 つの操作に置けるのは ${COMPUTE_EXAMPLE_LIMIT_PER_OPERATION} 本まで)`,
      location: action.computes.find((decl) => decl.examples.length > 0)?.location ?? action.location,
      suggestion: '例は代表的な入力だけにする(全部の組み合わせを並べる表ではない)。性質は手書きの性質テストが受け持つ',
      counterexample: { action: action.handles.raw, examples: String(total) },
    }),
  ];
}

/**
 * 全 action_spec の例の表を見る。
 *
 * @param model ドメイン仕様
 * @param actions 読み込めた action_spec
 * @returns V18 の指摘
 */
export function computeExampleFindings(model: SpecModel, actions: readonly ActionSpec[]): Finding[] {
  return [
    ...actions.flatMap((action) => action.computes.flatMap((decl) => checkDecl(model, action, decl))),
    ...actions.flatMap((action) => checkLimit(action)),
    ...checkOnePerRef(actions),
  ];
}
