/**
 * state_spec → 遷移テーブル(`app/src/domain/generated/{machine}.transitions.ts`)の生成器。
 *
 * ADR-0004: 実装は遷移表を持たず、生成された表を汎用エンジンが解釈する。仕様と実装のズレは
 * 「実装が表を持たない」ことで構造的に排除される。出力はエンジンの型契約
 * (`app/src/domain/engine/types.ts` の MachineTable)に `as const satisfies` で固定するため、
 * 契約から外れた生成物は app 側の typecheck で落ちる。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import { allMachines, type SpecModel, type StateMachineSpec } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral, toCamelCase, toPascalCase } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import { machineTableData } from '../../results/engine-tables.js';
import { activeStatesFromInvariants, type ActiveStates } from './state-sets.js';
import { RUNTIME_ENGINE_TYPES_MODULE } from './runtime-modules.js';


/**
 * 各状態機械から遷移テーブルファイルを生成するジェネレーター。
 * 出力は `app/src/domain/generated/{machine}.transitions.ts`(1 機械 1 ファイル・全体生成)。
 */
export const transitionTableGenerator: DocGenerator = {
  id: 'code-transitions',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    return allMachines(model).map(({ aggregate, machine }) => {
      const specs = model.aggregates.get(aggregate);
      const invariants = specs?.invariants;
      const entities = [machine.machine, aggregate, ...(specs?.entity === undefined ? [] : [specs.entity.entity])];
      const active = activeStatesFromInvariants(
        machine,
        invariants?.invariants ?? [],
        entities,
        ctx.guards,
      );
      return {
        file: generatedFile(ctx.roots, `${machine.machine}.transitions.ts`),
        content: renderTransitionsFile(machine, ctx, active, invariants?.location.file),
        wholeFile: true,
      };
    });
  },
};

/** 1 状態機械分の遷移テーブルファイル全体を組み立てる。 */
function renderTransitionsFile(
  machine: StateMachineSpec,
  ctx: GenerateContext,
  active: ActiveStates | null,
  invariantFile: string | undefined,
): string {
  const constName = `${toCamelCase(machine.machine)}Machine`;
  const table = machineTableData(machine, ctx.guards);

  const prefix = toCamelCase(machine.machine);
  const nonFinal = machine.states.filter((state) => !machine.final.includes(state));
  const sources = active === null || invariantFile === undefined ? [] : [invariantFile];

  return [
    generatedHeader([machine.location.file, ...sources]),
    '',
    `import type { MachineTable } from '${RUNTIME_ENGINE_TYPES_MODULE}';`,
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      `${machine.machine} の状態機械の遷移テーブル。`,
      '表に無い (from, event) の組み合わせは otherwise_forbidden による暗黙の禁止である。',
      `仕様: ${machine.location.file}`,
    ]),
    `export const ${constName} = ${frozen(`${renderLiteral(table)} as const satisfies MachineTable`)};`,
    '',
    docComment([
      `${machine.machine} の状態 ID の型(states の全列挙)。`,
      '**状態名を書ける口にはこの型を当てる**(DB 行の写像・画面 props・テストのフィクスチャ)。',
      '素の string で受けると、実在しない状態名を書いても tsc も検査器も検出できず、',
      '「動くが誰にも当たらない綴り違い」がテストの中に residue として残る。',
      `仕様: ${machine.location.file}`,
    ]),
    `export type ${toPascalCase(machine.machine)}State = (typeof ${constName}.states)[number];`,
    '',
    docComment([
      `${machine.machine} の終端状態(state_spec の final)。ここから出る遷移は無い。`,
      `仕様: ${machine.location.file}`,
    ]),
    `export const ${prefix}FinalStates = ${frozen(`${renderLiteral(machine.final)} as const`)};`,
    '',
    docComment([
      `${machine.machine} の非終端状態(final の補集合)。`,
      '「まだ遷移しうるもの」の集合であって、業務が言う「アクティブ」とは限らない',
      active === null
        ? '(そちらを使うなら、不変条件の where 句として先に宣言する)。'
        : `(そちらは不変条件が定義する。${prefix}ActiveStates を参照)。`,
      `仕様: ${machine.location.file}`,
    ]),
    `export const ${prefix}NonFinalStates = ${frozen(`${renderLiteral(nonFinal)} as const`)};`,
    ...(active === null ? [] : activeStatesLines(prefix, active)),
    '',
  ].join('\n');
}

/**
 * 不変条件から導いたアクティブ状態の宣言。
 *
 * 導出できなかった場合(候補が無い・結論が食い違う)は何も出さない。
 * 「アクティブ」を仕様の外で決めないためであり、必要なら不変条件の `where` を先に書く。
 */
function activeStatesLines(prefix: string, active: ActiveStates): string[] {
  return [
    '',
    docComment([
      `${prefix} のアクティブな状態(不変条件が「対象から外す」と宣言した状態の補集合)。`,
      `正は ${active.sources.join(' / ')} の where 句であり、ここはその写像である。`,
      '画面が「まだ生きている 1 件」を選ぶときはこの集合を使う(条件を書き写さない)。',
    ]),
    `export const ${prefix}ActiveStates = ${frozen(`${renderLiteral(active.states)} as const`)};`,
  ];
}

