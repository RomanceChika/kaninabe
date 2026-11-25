/**
 * usecase_spec の保存点 → **複合 RPC の migration**(`supabase/migrations/{migration}`)の生成器。
 *
 * ADR-0011 §4「保存点の内側は全部か無しか」の実装である。保存点の手順を宣言順に、
 * 既存の RPC を**名前付き記法**で 1 トランザクションの中から呼ぶ plpgsql を書き出す。
 * 引数に何を渡すかは param-source.ts の閉じた規約だけで決まり、決まらない引数が 1 本でも
 * あれば**生成時エラー**にする(実行時に推測しない。同じ問いを検査 Y8 が先に立てている)。
 *
 * ## なぜ「生成して貼る」形なのか(rpc-expectations との違い)
 *
 * 既存の RPC は人が書いた migration が正で、生成物は**期待**として突き合わせる(rpc-parity)。
 * 複合 RPC は逆で、**仕様から本文まで決まる**ので生成物そのものが正になる。migration が
 * 追記専用の歴史である点は変わらないため、**書き出す先のファイル名を仕様に宣言させ
 * (`saves[].migration`)、SQL が変わる変更では名前を新しくする**という運用で両立させる
 * (Y7 が形式と一意性を、usecase-rpc-parity が実 DB との一致を見る)。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import { sqlCommentText } from '../../kernel/safe-text.js';
import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { resolveSaveParams } from '../../usecase/param-source.js';
import type { PlanProblem, SavePlan, SaveStepPlan } from '../../usecase/step-plan.js';
import { planSave } from '../../usecase/step-plan.js';
import type { UsecaseSpec } from '../../model/usecase/types.js';
import type { CompositeResolvedParam } from '../../usecase/save-renderable.js';
import { narrowCompositeParams } from '../../usecase/save-renderable.js';
import { preconditionFailure } from '../../kernel/generator-precondition.js';
import { COMPOSITE_ARGS, COMPOSITE_PARAMS } from '../../usecase/composite.js';
import { callStatement, readbackEntries, sqlString } from './usecase-sql.js';
import { resendAfterAnchor, resendBlock, resendDigestOf, type ReadbackShape } from './usecase-rpc-resend.js';
import { resendDigestStoreProblem, resendDigestTableOf, type ResendDigestTable } from '../../usecase/resend-policy.js';
import { dropStaleOverloads } from '../../sql/rpc-signature.js';
import type { PlatformProfile } from '../../model/product/platform-profile.js';
import { exposed, privilegedRole } from '../../sql/platform-sql.js';
import { migrationPath, specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';


/**
 * 全 usecase_spec の保存点から複合 RPC の migration を生成するジェネレーター。
 * 出力は保存点ごとに `supabase/migrations/{saves[].migration}`(ファイル全体)。
 */
export const usecaseRpcGenerator: DocGenerator = {
  id: 'code-usecase-rpc',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const usecases = ctx.usecases;
    if (usecases === undefined || !usecases.available || usecases.usecases.length === 0) return [];
    if (ctx.dataTables === undefined || !ctx.dataTables.available) return [];

    const sections: GeneratedSection[] = [];
    for (const usecase of [...usecases.usecases].sort((a, b) => a.name.localeCompare(b.name))) {
      for (const save of usecase.saves) {
        const planned = planSave(usecase, save, {
          domain: model,
          actions: ctx.actions ?? null,
          dataTables: ctx.dataTables,
        });
        // 接地・解決・写せるかは Y8 / Y12 が先に同じ関数で見ている。破れていたらここは
        // 「検査の穴」なので、その検査器の ID を示して Finding の形で止める(scripts-code-quality.md)。
        if (!planned.ok) stop('Y8', usecase, save.id, planned.problems);
        const resolved = resolveSaveParams(planned.plan, model);
        if (!resolved.ok) stop('Y8', usecase, save.id, resolved.problems);
        const narrowed = narrowCompositeParams(planned.plan, resolved.steps);
        if (!narrowed.ok) stop('Y12', usecase, save.id, narrowed.problems);
        // 再送の読み直しは Y12 と共有の 1 本が**式ごと**返す(生成器は同じ判定を回さない)。
        const readback = readbackEntries(planned.plan, resolved.steps);
        if (!readback.ok) stop('Y12', usecase, save.id, readback.problems);
        // 再送の入力の要約の置き場(仕組みの表 resend_digests)が要るのに無ければ、Y12 が同じ 1 本で先に止めている。
        const storeProblem = resendDigestStoreProblem(readback.resend, ctx.dataTables.tables);
        if (storeProblem !== null) stop('Y12', usecase, save.id, [storeProblem]);
        sections.push({
          file: migrationPath(ctx.roots, `${save.migration}`),
          content: renderMigration(planned.plan, narrowed.steps, readback, resendDigestTableOf(ctx.dataTables.tables), ctx.roots, ctx.platform),
          wholeFile: true,
        });
      }
    }
    return sections;
  },
};

/**
 * 生成を中止する(**その前提を先に見るべき検査器**の ID を示して Finding の形で止める)。
 *
 * @param verifier 前提を見る検査器の ID(Y8 = 接地と引数の解決 / Y12 = 複合 RPC に写せるか)
 * @param usecase 対象のユースケース(場所を借りる)
 * @param saveId 対象の保存点
 * @param problems 破れた前提(3 点セット)
 */
function stop(verifier: string, usecase: UsecaseSpec, saveId: string, problems: readonly PlanProblem[]): never {
  return preconditionFailure(
    verifier,
    problems.map((problem) => ({
      message: problem.message,
      suggestion: problem.suggestion,
      counterexample: problem.counterexample,
      location: { file: usecase.location.file, pointer: `saves.${saveId}` },
    })),
  );
}

/** migration 1 枚を組み立てる。 */
function renderMigration(
  plan: SavePlan,
  steps: readonly (readonly CompositeResolvedParam[])[],
  readback: ReadbackShape,
  store: ResendDigestTable | null,
  roots: ProductRoots,
  platform: PlatformProfile,
): string {
  const variables = variableNames(plan);
  const digest = resendDigestOf(plan, readback, store);
  // 錨の作成の前後に、再送の印を消す文と、印を見て以降の手順を実行せずに合流する文を置く(点検 22 回目 A22-1)。
  const around = resendAfterAnchor(readback, digest);
  const body = plan.steps.map((step, index) => {
    const block = stepBlock(step, steps[index] ?? [], variables, platform);
    return step.index === readback.anchor?.index ? [...around.before, block, ...around.after].join('\n') : block;
  });
  return [
    ...header(plan, roots),
    '',
    ...dropStaleOverloads(platform.exposedSchema, plan.rpcName, COMPOSITE_ARGS),
    '',
    `create or replace function ${exposed(platform, plan.rpcName)}(`,
    COMPOSITE_PARAMS.map((name, index) => `    ${name} ${COMPOSITE_ARGS[index]}`).join(',\n'),
    ') returns jsonb',
    'language plpgsql',
    'security definer',
    'set search_path = public',
    'as $$',
    declareBlock(plan, variables),
    'begin',
    ...resendBlock(readback, steps[0] ?? [], variables, platform, digest),
    body.join('\n\n'),
    '',
    ...(digest === null ? [] : [digest.record, '']),
    '    return v_result;',
    'end;',
    '$$;',
    '',
    ...grants(plan, platform),
    '',
  ].join('\n');
}

/** 先頭の AUTO-GENERATED ヘッダ(SQL コメント)。 */
function header(plan: SavePlan, roots: ProductRoots): string[] {
  return [
    '-- AUTO-GENERATED by `npm run generate` — 手編集禁止。',
    '--',
    '-- このファイルの正は次の仕様であり、ここはその機械的な写像にすぎない。',
    '-- 変更するときは仕様を編集してから再生成すること(ADR-0006)。',
    `--   - ${sqlCommentText(specPath(roots, 'frontend/usecases', plan.usecase.relPath))}(保存点 ${plan.save.id})`,
    '--',
    '-- SQL が変わる仕様変更をしたら saves[].migration の名前を新しくする(適用済みの migration は',
    '-- 書き換えない。migrations.md §生成 migration)。関数は create or replace なので、新しい',
    '-- ファイルが同じ名前の関数を置き換える。',
    '--',
    `-- 目的: ${sqlCommentText(plan.usecase.goal)} / 保存点: ${sqlCommentText(plan.save.label)}`,
  ];
}

/**
 * 手順ごとの行変数の名前(手順番号 → 変数名)。
 *
 * 同じ集約を**動かす**手順(作成の直後の遷移)は 1 本を使い回す —— 遷移 RPC は動かした後の
 * 行を返すので、同じ変数に入れ直すのが正しい。一方、同じ集約を**もう 1 行作る**手順
 * (別名 `as` を持つ 2 つ目の作成)は別の行なので、別名から採った変数を新しく立てる。
 */
function variableNames(plan: SavePlan): ReadonlyMap<number, string> {
  const names = new Map<number, string>();
  const used = new Set<string>();
  // 集約 → 直前の「繰り返さない」手順の変数(遷移が使い回す先。createdRef と同じ見方)。
  const current = new Map<string, string>();
  for (const step of plan.steps) {
    const inherited = step.kind === 'transition' ? current.get(step.entity) : undefined;
    const name = inherited ?? freshVariable(step, used);
    used.add(name);
    names.set(step.index, name);
    if (!step.repeat) current.set(step.entity, name);
  }
  return names;
}

/** まだ使っていない行変数の名前(集約の名前を優先し、取られていれば別名から採る)。 */
function freshVariable(step: SaveStepPlan, used: ReadonlySet<string>): string {
  const byEntity = `v_${step.entity}`;
  return used.has(byEntity) ? `v_${step.alias}` : byEntity;
}

/** declare 節(行変数・繰り返しの作業変数・結果)。 */
function declareBlock(plan: SavePlan, variables: ReadonlyMap<number, string>): string {
  const rows = new Map<string, string>();
  for (const step of plan.steps) {
    const name = variables.get(step.index);
    if (name !== undefined) rows.set(name, `    ${name} public.${step.table};`);
  }
  const repeats = plan.steps.some((step) => step.repeat);
  return [
    'declare',
    ...rows.values(),
    ...(repeats ? ['    v_element jsonb;', "    v_items jsonb;"] : []),
    "    v_result jsonb := '{}'::jsonb;",
  ].join('\n');
}

/** 手順 1 つぶんのブロック(繰り返しならループで包む)。 */
function stepBlock(
  step: SaveStepPlan,
  params: readonly CompositeResolvedParam[],
  variables: ReadonlyMap<number, string>,
  platform: PlatformProfile,
): string {
  const alias = step.alias === step.op ? '' : `(as ${step.alias})`;
  const label = `    -- 手順 ${step.index + 1}: ${step.op}${alias}${step.repeat ? '(繰り返し)' : ''}`;
  const target = variables.get(step.index) ?? 'v_row';
  if (!step.repeat) {
    return [
      label,
      callStatement(step, params, variables, '    ', platform),
      `    v_result := v_result || jsonb_build_object(${sqlString(step.alias)}, to_jsonb(${target}));`,
    ].join('\n');
  }
  return [
    label,
    "    v_items := '[]'::jsonb;",
    `    for v_element in select * from jsonb_array_elements(coalesce(p_input -> ${sqlString(step.alias)}, '[]'::jsonb))`,
    '    loop',
    callStatement(step, params, variables, '        ', platform),
    `        v_items := v_items || jsonb_build_array(to_jsonb(${target}));`,
    '    end loop;',
    `    v_result := v_result || jsonb_build_object(${sqlString(step.alias)}, v_items);`,
  ].join('\n');
}

/** 実行権限(RPC は内部実行のロールからしか呼び出させない。database-guards.md)。 */
function grants(plan: SavePlan, platform: PlatformProfile): string[] {
  const signature = `${exposed(platform, plan.rpcName)}(${COMPOSITE_ARGS.join(', ')})`;
  return [
    `comment on function ${signature} is`,
    `    ${sqlString(`${plan.usecase.goal} — 保存点「${plan.save.label}」を 1 トランザクションで実行する(生成物)。`)};`,
    '',
    `revoke all on function ${signature} from public;`,
    `grant execute on function ${signature} to ${privilegedRole(platform)};`,
  ];
}
