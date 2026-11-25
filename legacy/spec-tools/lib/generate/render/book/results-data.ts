/**
 * 結果表の**元データ**(`docs/book/assets/results/*.json`)の生成器(束 ⑳-5b)。
 *
 * ハンドブックに載る表は 2 軸に畳んだ姿である。畳む前の全列挙をここに置いておくのは、
 * 「その ✅ / ❌ はどの組み合わせで出たのか」を**機械で辿れる**ようにするためである ——
 * 表とテストが別の列挙から出ていないことは単体テストが数で固定する(`count` との一致)。
 *
 * 形は**組み合わせ 1 つ = 1 行のタプル**である。鍵を全行に書くと 1 集約で数百 KB になり、
 * 差分がレビューできなくなる —— 鍵の並びは `caseFields` が、拒否の理由は `refusals` が
 * 1 度だけ宣言し、行はその番号を持つ(0 = 通る)。
 *
 * 置き場が `book/assets/` なのは、ハンドブックが配る資材(CSS・プレビュー断片)と同じ扱いだから
 * である。どちらも wholeFile の生成物なので、**鮮度**(中身が仕様とずれていないか)は
 * generate:check が検出する。**余分**(集約をリネームしたときに残る、どの仕様からも出ない
 * json)は別の検査である —— JSON は `AUTO-GENERATED` の行を持てないので、目印ではなく
 * 「置き場ぜんたいが生成物であり、宣言集合に無いファイルは全部余分」で判定する
 * (`apply-sections.ts` の `findUndeclaredInGeneratedDir`。束 ⑳-5b-b)。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { SpecModel } from '../../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../../gen-kit/generator.js';
import type { ResultDecision } from '../../../results/decide.js';
import type { ResultAggregate } from '../../../results/cases.js';
import { resultAggregates } from '../../../results/cases.js';
import type { SaveResult } from '../../../results/save-cases.js';
import { saveResults } from '../../../results/save-cases.js';
import { asCompactJson } from './results-json.js';
import { resultsDir } from './results-section.js';

/** 単発の操作の 1 行の並び。 */
const CASE_FIELDS = ['state', 'actor', 'array', 'field', 'axis', 'refusal'] as const;

/** 保存点の 1 行の並び(`steps` は手順ごとの番号。-1 = 判定に届かない)。 */
const SAVE_CASE_FIELDS = ['actor', 'caller', 'repeat', 'input', 'axis', 'blockedAt', 'steps'] as const;

/** 判定に届かなかった手順の番号。 */
const NOT_REACHED = -1;

/**
 * 結果表の元データを生成するジェネレーター。
 * 出力は `docs/book/assets/results/{集約}.json`(単発の操作)と `{ユースケース}.json`(保存点)。
 */
export const bookResultsDataGenerator: DocGenerator = {
  id: 'book-results-data',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const sections: GeneratedSection[] = [];
    for (const aggregate of resultAggregates({
      domain: model,
      guards: ctx.guards,
      actions: ctx.actions,
      dataTables: ctx.dataTables,
      jobs: ctx.jobs,
    })) {
      sections.push({
        file: `${resultsDir(ctx.roots)}/${aggregate.aggregate}.json`,
        content: asCompactJson(aggregateData(aggregate)),
        wholeFile: true,
      });
    }
    for (const [usecase, saves] of byUsecase(
      saveResults({
        domain: model,
        guards: ctx.guards,
        actions: ctx.actions,
        dataTables: ctx.dataTables,
        usecases: ctx.usecases,
      }),
    )) {
      sections.push({
        file: `${resultsDir(ctx.roots)}/${usecase}.json`,
        content: asCompactJson({ usecase, caseFields: SAVE_CASE_FIELDS, saves: saves.map(saveData) }),
        wholeFile: true,
      });
    }
    return sections;
  },
};

/** ユースケース → その保存点(鍵の順)。 */
function byUsecase(saves: readonly SaveResult[]): ReadonlyMap<string, readonly SaveResult[]> {
  const grouped = new Map<string, SaveResult[]>();
  for (const save of saves) grouped.set(save.usecase, [...(grouped.get(save.usecase) ?? []), save]);
  return grouped;
}

/** 集約 1 つぶんの元データ(畳む前の全列挙)。 */
function aggregateData(aggregate: ResultAggregate): unknown {
  return {
    aggregate: aggregate.aggregate,
    ops: aggregate.ops,
    problems: aggregate.problems,
    caseFields: CASE_FIELDS,
    actors: aggregate.actors.map((actor) => ({
      key: actor.key,
      role: actor.role,
      basis: actor.basis,
      ...(actor.unmet === undefined ? {} : { unmet: actor.unmet }),
      arrays: actor.arrays.map((array) => ({ name: array.name, roles: array.roles })),
    })),
    operations: aggregate.operations.map((operation) => {
      const refusals = openRefusals();
      const cases = operation.cases.map((found) => [
        found.state,
        found.actor,
        found.array,
        found.field,
        found.axis.map((axis) => axis.label),
        refusals.numberOf(found.decision),
      ]);
      return {
        op: operation.op,
        kind: operation.kind,
        enforcement: operation.enforcement,
        count: operation.count,
        folded: operation.folded,
        foldedGuards: operation.foldedGuards,
        refusals: refusals.rows(),
        cases,
      };
    }),
  };
}

/** 保存点 1 つぶんの元データ(手順ごとの結末つき)。 */
function saveData(save: SaveResult): unknown {
  const refusals = openRefusals();
  const cases = save.cases.map((found) => [
    found.actor,
    found.caller,
    found.repeat,
    found.input,
    found.axis.map((axis) => axis.label),
    found.blockedAt,
    found.steps.map((step) => (step.reached ? refusals.numberOf(step.decision) : NOT_REACHED)),
  ]);
  return {
    key: save.key,
    save: save.save,
    count: save.count,
    folded: save.folded,
    foldedGuards: save.foldedGuards,
    problems: save.problems,
    actors: save.actors.map((actor) => ({
      key: actor.key,
      role: actor.role,
      basis: actor.basis,
      ...(actor.unmet === undefined ? {} : { unmet: actor.unmet }),
    })),
    steps: save.steps.map((step) => ({ op: step.op, label: step.label })),
    refusals: refusals.rows(),
    cases,
  };
}

/** 拒否の理由に番号を振る帳面(0 は「通る」に予約する)。 */
interface Refusals {
  /** その判定の番号(許可なら 0)。 */
  readonly numberOf: (decision: ResultDecision) => number;
  /** 番号順の拒否の並び。 */
  readonly rows: () => readonly unknown[];
}

/** 帳面を開く(操作 / 保存点 1 つにつき 1 冊)。 */
function openRefusals(): Refusals {
  const keys: string[] = [];
  const rows: unknown[] = [];
  return {
    numberOf: (decision: ResultDecision): number => {
      if (decision.allowed) return 0;
      const key = JSON.stringify([
        decision.reason,
        decision.allowedRoles,
        decision.guardSource,
        decision.otherwiseForbidden,
      ]);
      const found = keys.indexOf(key);
      if (found >= 0) return found + 1;
      keys.push(key);
      rows.push({
        reason: decision.reason,
        ...(decision.allowedRoles.length === 0 ? {} : { allowedRoles: decision.allowedRoles }),
        ...(decision.guardSource === null ? {} : { guardSource: decision.guardSource }),
        ...(decision.otherwiseForbidden === null ? {} : { otherwiseForbidden: decision.otherwiseForbidden }),
      });
      return keys.length;
    },
    rows: (): readonly unknown[] => rows,
  };
}
