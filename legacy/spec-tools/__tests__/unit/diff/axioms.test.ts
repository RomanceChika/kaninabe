/**
 * 公理の側の差分(`lib/diff/axioms.ts`)と、`spec:diff` の結果の公理 / 導出の分類(`lib/diff/reading.ts`)のテスト。
 *
 * 仕組み側の語彙で書く(アプリの集約・状態の名前は使わない)。比べるのは生成物に写された言明と表示名で、
 * 書き方の差(並び替え・コメント)は事実の表に残らないので差分に化けない。
 */

import { describe, expect, it } from 'vitest';
import { axiomChanges, axiomFactsOfModel, axiomReading } from '../../../lib/diff/axioms.js';
import { readableFacts, readAxiomFacts } from '../../../lib/diff/axiom-read.js';
import { AXIS_ELEMENT, axisClass, splitByReading } from '../../../lib/diff/reading.js';
import { renderDiff } from '../../../lib/diff/render.js';
import { generatedStatementsPath, generatedSummariesPath } from '../../../lib/diff/axiom-sources.js';
import type { DiffAxis, DiffOutcome } from '../../../lib/diff/types.js';
import { aggregate, entitySpec, event, machine, specModel, roleSpec, role } from '../../helpers/model-builder.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import type { ActionComputeExample } from '../../../lib/model/trace/types.js';
import { GENERATED, snapshot } from './fixtures.js';

const STATEMENTS = `export const invariantStatements = {\n  'INV-X-001': '数は上限を超えない',\n  'INV-X-002': '名前は重複しない',\n} as const;\n`;
const LABELS = `export const unitStateLabels = {\n  open: '開いている',\n} as const;\nexport const unitEventLabels = {\n  close: '閉じる',\n} as const;\n`;

describe('readAxiomFacts(生成物の写し 1 版から公理の側の事実を読む)', () => {
  it('不変条件の言明・状態の表示名・イベントの呼び名を、種類つきの鍵で表にする', () => {
    const facts = readAxiomFacts(
      snapshot({ [generatedStatementsPath(TEST_ROOTS)]: STATEMENTS, [`${GENERATED}/unit.labels.ts`]: LABELS }),
      TEST_ROOTS,
      'head',
    ).table;

    expect([...facts.entries()].sort()).toEqual([
      ['event:unit.close', '閉じる'],
      ['invariant:INV-X-001', '数は上限を超えない'],
      ['invariant:INV-X-002', '名前は重複しない'],
      ['state:unit.open', '開いている'],
    ]);
  });

  it('その版に生成物が無い(null)なら事実が無く、問題でもない(例外にしない)', () => {
    const read = readAxiomFacts(snapshot({ [generatedStatementsPath(TEST_ROOTS)]: null }), TEST_ROOTS, 'base');

    expect(read.table.size).toBe(0);
    expect(read.problems).toEqual([]);
    expect(read.blind).toEqual([]);
  });

  it('ファイルはあるが読めない export は「事実が無い」ではなく読めなかったと報告し、その源の範囲は比べない', () => {
    const path = generatedStatementsPath(TEST_ROOTS);
    const read = readAxiomFacts(snapshot({ [path]: 'export const invariantStatements = foo();' }), TEST_ROOTS, 'base');

    expect(read.table.size).toBe(0);
    expect(read.problems).toHaveLength(1);
    expect(read.problems[0]).toMatchObject({ kind: 'unreadable', side: 'base', path });
    expect(read.blind).toEqual([{ elements: ['invariant.statement'], keyPrefix: '' }]);
  });

  it('export の宣言が無い版は undeclared(古い版の姿。読めなかったとは数えず、比べない範囲にも入れない)', () => {
    const read = readAxiomFacts(snapshot({ [generatedStatementsPath(TEST_ROOTS)]: 'export const other = {};\n' }), TEST_ROOTS, 'head');

    expect(read.problems.map((problem) => problem.kind)).toEqual(['undeclared']);
    expect(read.blind).toEqual([]);
  });

  it('export がオブジェクトでない(配列・文字列)のも、読めなかったと報告する', () => {
    const read = readAxiomFacts(snapshot({ [generatedStatementsPath(TEST_ROOTS)]: "export const invariantStatements = ['a'];\n" }), TEST_ROOTS, 'head');

    expect(read.problems[0]).toMatchObject({ kind: 'unreadable', side: 'head' });
    expect(read.problems[0]?.reason).toContain('オブジェクトではありません');
  });

  it('表示名の写しは 1 本ずつ読み、壊れた 1 本の範囲(その状態機械の鍵)だけを比べない', () => {
    const broken = `export const otherStateLabels = {\n  open: ;\n} as const;\nexport const otherEventLabels = 1;\n`;
    const read = readAxiomFacts(
      snapshot({ [`${GENERATED}/unit.labels.ts`]: LABELS, [`${GENERATED}/other.labels.ts`]: broken }),
      TEST_ROOTS,
      'head',
    );

    expect([...read.table.keys()].sort()).toEqual(['event:unit.close', 'state:unit.open']);
    expect(read.problems.map((problem) => problem.path)).toEqual([`${GENERATED}/other.labels.ts`, `${GENERATED}/other.labels.ts`]);
    expect(read.blind).toEqual([
      { elements: ['state.label', 'transition.meaning'], keyPrefix: 'other.' },
      { elements: ['state.label', 'transition.meaning'], keyPrefix: 'other.' },
    ]);
  });
});

describe('axiomFactsOfModel(生成の入力の仕様モデルから、同じ形の事実を作る)', () => {
  it('生成物と同じ鍵の事実になる(状態の label・イベントの label・言明)', () => {
    const model = specModel(
      [
        aggregate('unit', {
          entity: entitySpec('unit'),
          stateMachines: [
            machine('unit', {
              states: ['open'],
              initial: 'open',
              stateLabels: { open: '開いている' },
              events: [event('close', { from: ['open'], to: 'open', by: ['chief'], label: '閉じる' })],
            }),
          ],
          invariants: {
            invariants: [{ id: 'INV-X-001', statement: '数は上限を超えない', entities: ['unit'], enforcedBy: [], location: { file: 'docs/specs/domain/unit/invariants.md' } }],
            location: { file: 'docs/specs/domain/unit/invariants.md' },
          },
        }),
      ],
      roleSpec([role('chief')]),
    );

    expect([...axiomFactsOfModel(model, []).entries()].sort()).toEqual([
      ['event:unit.close', '閉じる'],
      ['invariant:INV-X-001', '数は上限を超えない'],
      ['state:unit.open', '開いている'],
    ]);
  });
});

describe('計算の例の表は公理の側の差分に出る', () => {
  /** 例 1 行(`facts_input`)。 */
  const row = (note: string, expectValue: number, input: Readonly<Record<string, number>> = { qty: 2 }): ActionComputeExample => ({
    note,
    facts: { 'line.price': 100 },
    input,
    expect: expectValue,
    location: { file: 'x.md' },
  });
  const actionsOf = (rows: readonly ActionComputeExample[]) => [
    actionSpec({ handles: 'line.edit', computes: { 'line.total': 'totalOf' }, computeExamples: { 'line.total': rows } }),
  ];
  const summaries = (example: Readonly<Record<string, string>>): string => JSON.stringify({ entity: {}, machine: {}, state: {}, example });
  const baseModel = specModel([aggregate('unit', { entity: entitySpec('unit') })]);

  it('例の行は 操作/純関数/行の名前 の鍵で、入力 → 値の 1 本の字面になる', () => {
    const facts = axiomFactsOfModel(baseModel, actionsOf([row('二つ買う', 200)]));

    expect([...facts.entries()]).toEqual([['example:line.edit/totalOf/二つ買う', '{"facts":{"line.price":100},"input":{"qty":2}} → 200']]);
  });

  it('書く順に依らない: 入力・事実・期待値の鍵(入れ子も)の順を入れ替えても、同じ字面になる', () => {
    const written = (facts: ActionComputeExample['facts'], input: ActionComputeExample['input'], expectValue: ActionComputeExample['expect']) =>
      axiomFactsOfModel(baseModel, actionsOf([{ note: '二つ買う', facts, input, expect: expectValue, location: { file: 'x.md' } }]));
    const forwardInput = { qty: 2, coupon: { code: 'A', rate: 5 } };
    const reversedInput = { coupon: { rate: 5, code: 'A' }, qty: 2 };
    const forward = written(
      { 'line.price': 100, 'line.tax': 10 },
      forwardInput,
      { total: 200, detail: { tax: 20, base: 180 } },
    );
    const reversed = written(
      { 'line.tax': 10, 'line.price': 100 },
      reversedInput,
      { detail: { base: 180, tax: 20 }, total: 200 },
    );

    // 鍵の挿入順が本当に入れ替わっている(入れ替えていなければ、このテストは順序依存を見張れない)。
    expect(Object.keys(reversedInput)).not.toEqual(Object.keys(forwardInput));
    expect(Object.keys(reversedInput.coupon)).not.toEqual(Object.keys(forwardInput.coupon));
    expect([...reversed.entries()]).toEqual([...forward.entries()]);
    expect([...forward.values()]).toEqual([
      '{"facts":{"line.price":100,"line.tax":10},"input":{"coupon":{"code":"A","rate":5},"qty":2}} → {"detail":{"base":180,"tax":20},"total":200}',
    ]);
  });

  it('生成物の写し(summaries.json の example)から同じ鍵の事実を読む。仕様モデル側と同じなら差分は 0', () => {
    const written = summaries({ 'line.edit/totalOf/二つ買う': '{"facts":{"line.price":100},"input":{"qty":2}} → 200' });
    const base = readAxiomFacts(snapshot({ [generatedSummariesPath(TEST_ROOTS)]: written }), TEST_ROOTS, 'head').table;

    expect(axiomChanges(base, axiomFactsOfModel(baseModel, actionsOf([row('二つ買う', 200)])))).toEqual([]);
  });

  it('行が増えた・消えた・値が変わったとき、計算の例として差分に出る', () => {
    const base = readAxiomFacts(
      snapshot({
        [generatedSummariesPath(TEST_ROOTS)]: summaries({
          'line.edit/totalOf/二つ買う': '{"facts":{"line.price":100},"input":{"qty":2}} → 200',
          'line.edit/totalOf/消える行': '{"facts":{"line.price":100},"input":{"qty":1}} → 100',
        }),
      }),
      TEST_ROOTS,
      'head',
    ).table;
    const head = axiomFactsOfModel(baseModel, actionsOf([row('二つ買う', 250), row('三つ買う', 300, { qty: 3 })]));

    expect(axiomChanges(base, head).map((change) => [change.element, change.kind, change.key])).toEqual([
      ['computes.example', 'added', 'line.edit/totalOf/三つ買う'],
      ['computes.example', 'changed', 'line.edit/totalOf/二つ買う'],
      ['computes.example', 'removed', 'line.edit/totalOf/消える行'],
    ]);
  });

  it('shape: input の行は input だけを写す。公理の側の節に「計算の例」と出る', () => {
    const only = actionSpec({
      handles: 'line.edit',
      computes: { 'line.total': 'totalOf' },
      computeShapes: { 'line.total': 'input' },
      computeExamples: { 'line.total': [{ note: 'そのまま', facts: {}, input: { qty: 2 }, expect: { a: 1 }, location: { file: 'x.md' } }] },
    });
    const facts = axiomFactsOfModel(baseModel, [only]);
    expect([...facts.entries()]).toEqual([['example:line.edit/totalOf/そのまま', '{"input":{"qty":2}} → {"a":1}']]);

    const outcome: DiffOutcome = { changes: [], problems: [], comparedFiles: 0 };
    const text = renderDiff(outcome, 'HEAD~1', [], axiomChanges(new Map(), facts));
    expect(text).toContain('計算の例 `line.edit/totalOf/そのまま` が増えた');
  });
});

describe('比較先で読めなかった要素は「消えた」と混ぜず、別に報告する(axiomReading)', () => {
  const summaries = (example: Readonly<Record<string, string>>): string => JSON.stringify({ entity: {}, machine: {}, state: {}, example });
  const base = readAxiomFacts(
    snapshot({
      [generatedSummariesPath(TEST_ROOTS)]: summaries({
        'line.edit/totalOf/二つ買う': '{"input":{"qty":2}} → 200',
        'line.edit/totalOf/三つ買う': '{"input":{"qty":3}} → 300',
      }),
      [generatedStatementsPath(TEST_ROOTS)]: STATEMENTS,
    }),
    TEST_ROOTS,
    'base',
  );
  // 比較先は action_spec を読めず、例が 1 行も無い(不変条件は 1 本だけ消した)。
  const head = readAxiomFacts(
    snapshot({ [generatedSummariesPath(TEST_ROOTS)]: summaries({}), [generatedStatementsPath(TEST_ROOTS)]: STATEMENTS.replace(/ {2}'INV-X-002'.*\n/, '') }),
    TEST_ROOTS,
    'head',
  );

  it('読めたときは従来どおり、例の消えた行も差分に出し、報告は空', () => {
    const reading = axiomReading(base, head, { actions: true });

    expect(reading.changes.map((change) => [change.element, change.kind])).toEqual([
      ['computes.example', 'removed'],
      ['computes.example', 'removed'],
      ['invariant.statement', 'removed'],
    ]);
    expect(reading.notRead).toEqual([]);
  });

  it('読めなかったときは、例を「消えた」に数えず(他の要素の差分は残す)、読めなかったことを別の行で報告する', () => {
    const reading = axiomReading(base, head, { actions: false });

    expect(reading.changes.map((change) => [change.element, change.kind, change.key])).toEqual([['invariant.statement', 'removed', 'INV-X-002']]);
    expect(reading.notRead).toHaveLength(1);
    expect(reading.notRead[0]).toContain('読めなかった');
    expect(reading.notRead[0]).toContain('基点の 2 行');
    expect(reading.notRead[0]).not.toContain('が消えた');
  });

  it('比較先が仕様モデルから作った表(読めなかったものが無い側)でも同じ形で比べる', () => {
    const reading = axiomReading(base, readableFacts(head.table), { actions: true });

    expect(reading.changes).toHaveLength(3);
    expect(reading.problems).toEqual([]);
  });
});

describe('ファイルはあるが読めない源は、反対側を「消えた」「増えた」に化けさせず、読めなかったと報告する(axiomReading)', () => {
  const statements = generatedStatementsPath(TEST_ROOTS);
  const summaries = generatedSummariesPath(TEST_ROOTS);
  const good = (side: 'base' | 'head'): ReturnType<typeof readAxiomFacts> =>
    readAxiomFacts(snapshot({ [statements]: STATEMENTS, [summaries]: JSON.stringify({ entity: { unit: '章頭です。' } }) }), TEST_ROOTS, side);

  it('壊れた invariants.ts が比較先なら、言明は「消えた」と数えず、他の源の差分は残す', () => {
    const head = readAxiomFacts(
      snapshot({ [statements]: 'export const invariantStatements = {', [summaries]: JSON.stringify({ entity: { unit: '章頭を直しました。' } }) }),
      TEST_ROOTS,
      'head',
    );

    const reading = axiomReading(good('base'), head);

    expect(reading.changes.map((change) => [change.element, change.kind, change.key])).toEqual([['entity.summary', 'changed', 'unit']]);
    expect(reading.problems).toHaveLength(1);
    expect(reading.problems[0]).toMatchObject({ kind: 'unreadable', side: 'head', path: statements });
    expect(reading.notRead).toHaveLength(1);
    expect(reading.notRead[0]).toContain(statements);
    expect(reading.notRead[0]).toContain('比較先で読めなかった');
    expect(reading.notRead[0]).toContain('「消えた」「増えた」とは数えていない');
  });

  it('壊れた summaries.json が基点なら、要約は「増えた」と数えない', () => {
    const base = readAxiomFacts(snapshot({ [statements]: STATEMENTS, [summaries]: '{' }), TEST_ROOTS, 'base');

    const reading = axiomReading(base, good('head'));

    expect(reading.changes).toEqual([]);
    expect(reading.problems[0]).toMatchObject({ kind: 'unreadable', side: 'base', path: summaries });
    expect(reading.notRead[0]).toContain('基点で読めなかった');
  });

  it('要約の写しは最上位がオブジェクトでない・節がオブジェクトでないときも読めなかったとし、事実を 1 件も足さない', () => {
    for (const broken of ['null', '"text"', '[1]', JSON.stringify({ entity: 1 }), JSON.stringify({ entity: { unit: '章頭です。' }, example: [] })]) {
      const read = readAxiomFacts(snapshot({ [summaries]: broken }), TEST_ROOTS, 'head');

      expect(read.table.size, broken).toBe(0);
      expect(read.problems.map((problem) => problem.kind), broken).toEqual(['unreadable']);
    }
  });

  it('読めた側どうしなら、これまでどおりの差分で、報告は空', () => {
    const reading = axiomReading(good('base'), good('head'));

    expect(reading.changes).toEqual([]);
    expect(reading.problems).toEqual([]);
    expect(reading.notRead).toEqual([]);
  });

  it('宣言が無い(undeclared)だけの版は、読めなかったとは数えず notRead に載せない(報告の problems には残す)', () => {
    const head = readAxiomFacts(snapshot({ [statements]: 'export const other = {};\n' }), TEST_ROOTS, 'head');

    const reading = axiomReading(good('base'), head);

    expect(reading.notRead).toEqual([]);
    expect(reading.problems.map((problem) => problem.kind)).toEqual(['undeclared']);
    // 比べない範囲には入らないので、言明は消えた側に出る(古い版との比較で起きる、宣言が無い版の姿)。
    expect(reading.changes.filter((change) => change.element === 'invariant.statement')).toHaveLength(2);
  });
});

describe('要約の文(章頭の 1 文・節の要約・段の場面)は公理の側の差分に出る', () => {
  const summaries = (entity: string, state: string): string =>
    JSON.stringify({ entity: { unit: entity }, machine: { unit: '節の要約です。' }, state: { 'unit.open': state } });
  const base = readAxiomFacts(snapshot({ [generatedSummariesPath(TEST_ROOTS)]: summaries('章頭です。', '場面です。') }), TEST_ROOTS, 'head').table;

  it('生成物の写し(summaries.json)から、種類つきの鍵で事実の表にする', () => {
    expect([...base.entries()].sort()).toEqual([
      ['summary-entity:unit', '章頭です。'],
      ['summary-machine:unit', '節の要約です。'],
      ['summary-state:unit.open', '場面です。'],
    ]);
  });

  it('文が書き換わった・消えたとき、要素の種類つきで差分に出る(58 文が動いても 0 のままにしない)', () => {
    const head = readAxiomFacts(snapshot({ [generatedSummariesPath(TEST_ROOTS)]: summaries('章頭を直しました。', '場面です。').replace('"machine":{"unit":"節の要約です。"},', '') }), TEST_ROOTS, 'head').table;

    expect(axiomChanges(base, head).map((change) => [change.element, change.kind, change.key])).toEqual([
      ['entity.summary', 'changed', 'unit'],
      ['machine.summary', 'removed', 'unit'],
    ]);
  });

  it('仕様モデルからも同じ鍵の事実を作る(書かれたものだけ)', () => {
    const model = specModel([
      aggregate('unit', {
        entity: { ...entitySpec('unit'), summary: '章頭です。' },
        stateMachines: [machine('unit', { states: ['open'], initial: 'open', summary: '節の要約です。', stateSummaries: { open: '場面です。' } })],
      }),
    ]);

    expect(axiomChanges(base, axiomFactsOfModel(model, []))).toEqual([]);
  });

  it('写しが壊れている・形が違うときは、事実を足さず(例外にしない)、読めなかったと報告する', () => {
    for (const broken of ['{', 'null', '"text"', JSON.stringify({ entity: 1 })]) {
      const read = readAxiomFacts(snapshot({ [generatedSummariesPath(TEST_ROOTS)]: broken }), TEST_ROOTS, 'head');

      expect(read.table.size, broken).toBe(0);
      expect(read.problems.map((problem) => problem.kind), broken).toEqual(['unreadable']);
    }
  });
});

describe('axiomChanges(2 版の事実の表から公理の側の差分)', () => {
  const base = readAxiomFacts(snapshot({ [generatedStatementsPath(TEST_ROOTS)]: STATEMENTS, [`${GENERATED}/unit.labels.ts`]: LABELS }), TEST_ROOTS, 'head').table;

  it('同じなら 0 件', () => {
    expect(axiomChanges(base, base)).toEqual([]);
  });

  it('言明が変わった・増えた・消えた、状態の表示名が変わった、が種類つきで出る', () => {
    const head = readAxiomFacts(
      snapshot({
        [generatedStatementsPath(TEST_ROOTS)]: `export const invariantStatements = {\n  'INV-X-001': '数は上限を超えてはならない',\n  'INV-X-003': '新しい約束',\n} as const;\n`,
        [`${GENERATED}/unit.labels.ts`]: LABELS.replace('開いている', '受付中'),
      }),
      TEST_ROOTS,
      'head',
    ).table;

    expect(axiomChanges(base, head).map((change) => [change.element, change.kind, change.key])).toEqual([
      ['invariant.statement', 'changed', 'INV-X-001'],
      ['invariant.statement', 'removed', 'INV-X-002'],
      ['invariant.statement', 'added', 'INV-X-003'],
      ['state.label', 'changed', 'unit.open'],
    ]);
  });

  it('書き方の差(コメント・並び替え)は差分に化けない', () => {
    const reordered = readAxiomFacts(
      snapshot({
        [generatedStatementsPath(TEST_ROOTS)]: `// 並び替え\nexport const invariantStatements = {\n  'INV-X-002': '名前は重複しない',\n  'INV-X-001': '数は上限を超えない',\n} as const;\n`,
        [`${GENERATED}/unit.labels.ts`]: LABELS,
      }),
      TEST_ROOTS,
      'head',
    ).table;

    expect(axiomChanges(base, reordered)).toEqual([]);
  });
});

describe('splitByReading(spec:diff の結果を公理 / 導出に分ける)', () => {
  const outcome: DiffOutcome = {
    changes: [{ axis: 'permission', direction: 'widened', subject: 'op', before: null, after: null, text: '🔓 できるようになった' }],
    problems: [],
    comparedFiles: 1,
  };
  const axiom = [{ element: 'invariant.statement' as const, kind: 'changed' as const, key: 'INV-X-001', before: 'a', after: 'b' }];

  it('6 軸の行はすべて導出の側、公理の側の差分は公理の側', () => {
    const split = splitByReading(outcome, axiom);

    expect(split.derived).toHaveLength(1);
    expect(split.axiom).toEqual(axiom);
  });

  it('どの軸も要素の種類に結ばれ、導出に分類される(軸を足すと、ここで分類を書かない限り型が通らない)', () => {
    const axes = Object.keys(AXIS_ELEMENT) as DiffAxis[];

    expect(axes.sort()).toEqual(['columns', 'notifications', 'operations', 'permission', 'rows', 'screens']);
    for (const axis of axes) expect(axisClass(axis), axis).toBe('derived');
  });
});

describe('renderDiff(公理の側の節)', () => {
  const outcome: DiffOutcome = { changes: [], problems: [], comparedFiles: 3 };

  it('公理の側を渡さなければ、従来の出力のまま(節を出さない)', () => {
    expect(renderDiff(outcome, 'abc')).not.toContain('公理の側');
  });

  it('公理の側を渡すと、節と導出の側の前置きを出す。前後の中身が読める', () => {
    const text = renderDiff(outcome, 'abc', [], [
      { element: 'invariant.statement', kind: 'changed', key: 'INV-X-001', before: '旧', after: '新' },
      { element: 'state.label', kind: 'added', key: 'unit.open', before: null, after: '開いている' },
    ]);

    expect(text).toContain('### 公理の側の差分(人が読む)(2 件)');
    expect(text).toContain('- 🔁 不変条件 `INV-X-001` の中身が変わった');
    expect(text).toContain('  - 前: 旧');
    expect(text).toContain('  - 後: 新');
    expect(text).toContain('➕ 状態の表示名 `unit.open` が増えた');
    expect(text).toContain('以下の 6 軸は導出の側です');
  });

  it('要約の文の差分は、章頭・節・段の呼び名で出る', () => {
    const text = renderDiff(outcome, 'abc', [], [
      { element: 'entity.summary', kind: 'changed', key: 'unit', before: '旧', after: '新' },
      { element: 'machine.summary', kind: 'removed', key: 'unit', before: '節です。', after: null },
      { element: 'state.summary', kind: 'added', key: 'unit.open', before: null, after: '場面です。' },
    ]);

    expect(text).toContain('🔁 章頭の 1 文 `unit` の中身が変わった');
    expect(text).toContain('節の要約の文 `unit` が消えた');
    expect(text).toContain('➕ 段の場面の文 `unit.open` が増えた');
  });

  it('公理の側が 1 件以上あるとき、総括は「意味の差分はありません」と言い切らず、公理の側の件数を併記する', () => {
    const text = renderDiff(outcome, 'abc', [], [
      { element: 'invariant.statement', kind: 'changed', key: 'INV-X-001', before: '旧', after: '新' },
    ]);
    const head = text.split('\n').find((line) => line.includes('基点 abc')) ?? '';

    expect(head).toContain('6 軸(導出の側)に差分はありません');
    expect(head).toContain('公理の側の差分が 1 件');
    expect(text).not.toContain('意味の差分はありません');
  });

  it('公理の側が 0 件なら、従来どおり「意味の差分はありません」と言う(6 軸も公理の側も 0)', () => {
    expect(renderDiff(outcome, 'abc', [], [])).toContain('意味の差分はありません(基点 abc');
  });

  it('読めなかった生成物があるときは、公理の側があっても言い切らない', () => {
    const blind: DiffOutcome = { ...outcome, problems: [{ kind: 'unreadable', side: 'head', path: 'a/b.ts', reason: '閉じていません' }] };
    const text = renderDiff(blind, 'abc', [], [{ element: 'state.label', kind: 'added', key: 'unit.open', before: null, after: '開いている' }]);

    expect(text).toContain('判定できた 6 軸(導出の側)に差分はありません');
  });

  it('公理の側が 0 件でも、見たことを書く(黙らない)', () => {
    expect(renderDiff(outcome, 'abc', [], [])).toContain('公理の側に動いたものはありません');
  });
});
