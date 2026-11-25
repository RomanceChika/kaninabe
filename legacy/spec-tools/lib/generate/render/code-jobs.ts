/**
 * ジョブカタログ → 実装側の期待表(`app/src/domain/generated/jobs.ts`)の生成器。
 *
 * カタログが宣言する「人手なしで動くものの全数と、その出どころ・種別・失敗時の挙動」を
 * **実装が突き合わせられる形**に写す。app 側のユニットテストが登録済みハンドラと
 * 双方向に突き合わせ、「仕様に無いジョブ種別を実行する」「仕様にあるジョブのハンドラが無い」の
 * 両方を落とす(notifications.ts と同じ流儀)。
 *
 * 語彙(kind / on_failure)はこのアプリの宣言なので、型も**カタログから生成する**
 * (体系側に語の一覧を持たない)。
 *
 * `scheduler`(`source: schedule` の行だけが持つ、時刻で起きるジョブの鳴る場所)も写す ——
 * ADR-0010 により DB の中で鳴るジョブ(`database`)が現れたことで、「DB 内のスケジューラの口を
 * 秘密の保管庫に用意する必要があるか」を道具(`app/scripts/setup-secrets.mts`)が仕様から機械的に判定できる。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { JobCatalogSpec, JobVocabularyAxis } from '../../model/job/types.js';
import { JOB_SCHEDULERS, JOB_SOURCES, JOB_VOCABULARY_AXES } from '../../model/job/types.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { generatedFile, docComment, generatedHeader, renderLiteral, toPascalCase, tsString } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 期待表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'jobs.ts');

/** 軸ごとの TS 型名(`on_failure` → `JobOnFailure`)。 */
function axisTypeName(axis: JobVocabularyAxis): string {
  return `Job${toPascalCase(axis)}`;
}

/** 語彙 1 軸をユニオン型として出す。 */
function axisType(catalog: JobCatalogSpec, axis: JobVocabularyAxis): string[] {
  const terms = catalog.vocabulary[axis];
  const union = terms.length === 0 ? 'never' : terms.map((term) => tsString(term.id)).join(' | ');
  return [
    docComment([`${axis} の語彙(カタログの vocabulary.${axis} が正)。`]),
    `export type ${axisTypeName(axis)} = ${union};`,
    '',
  ];
}

/** ジョブ 1 本を突合用のリテラルに写す(`scheduler` / `emits` は `source: schedule` の行だけが、`anonymizes` は匿名化する効果の行だけが、`endsSessions` / `platformCall` はセッションを終える効果の行だけが、`inTransaction` は同一トランザクションで実現される効果の行だけが持つ)。 */
function jobLiteral(catalog: JobCatalogSpec): LiteralValue {
  return catalog.jobs.map((decl) => ({
    id: decl.id,
    source: decl.source,
    kind: decl.kind,
    onFailure: decl.onFailure,
    ...(decl.schedule?.scheduler === undefined ? {} : { scheduler: decl.schedule.scheduler }),
    ...(decl.schedule?.emits === undefined ? {} : { emits: decl.schedule.emits }),
    ...(decl.anonymizes === undefined ? {} : { anonymizes: decl.anonymizes }),
    ...(decl.endsSessions === undefined ? {} : { endsSessions: decl.endsSessions }),
    ...(decl.platformCall === undefined ? {} : { platformCall: decl.platformCall }),
    ...(decl.platformJob === undefined ? {} : { platformJob: decl.platformJob }),
    ...(decl.inTransaction === true ? { inTransaction: true } : {}),
  }));
}

/** 期待表のファイル全体を組み立てる。 */
function renderFile(catalog: JobCatalogSpec): string {
  const sources = JOB_SOURCES.map((source) => tsString(source)).join(' | ');
  const schedulers = JOB_SCHEDULERS.map((scheduler) => tsString(scheduler)).join(' | ');
  return [
    generatedHeader([catalog.location.file]),
    '',
    ...JOB_VOCABULARY_AXES.flatMap((axis) => axisType(catalog, axis)),
    docComment(['発火の出どころ(outbox = effects から積まれる / schedule = 時刻で起きる)。']),
    `export type JobSource = ${sources};`,
    '',
    docComment([
      '時刻で起きるジョブの鳴る場所(host = アプリを動かす場所の Cron / database = DB 内のスケジューラ。ADR-0010)。',
      '`source: schedule` の行だけが `scheduler` を持つ。',
    ]),
    `export type JobScheduler = ${schedulers};`,
    '',
    docComment([
      'ジョブ 1 本の宣言(summary は人間向けなので写さない — 突合の対象は 3 軸 + scheduler + emits + anonymizes + endsSessions + platformCall + platformJob + inTransaction)。',
    ]),
    'export interface JobDecl {',
    '  readonly id: string;',
    '  readonly source: JobSource;',
    '  readonly kind: JobKind;',
    '  readonly onFailure: JobOnFailure;',
    '  readonly scheduler?: JobScheduler;',
    '  /** 走査が outbox に積む通知の ID(時刻で起きる行だけが持つ。通知の発火元の 3 つ目)。 */',
    '  readonly emits?: readonly string[];',
    '  /** 匿名化する効果の行だけが持つ(匿名化の対象の集約 id)。 */',
    '  readonly anonymizes?: string;',
    '  /** セッションを終える効果の行だけが持つ(ログイン状態を終える対象のアカウントの集約 id)。 */',
    '  readonly endsSessions?: string;',
    '  /** セッションを終える効果の行だけが持つ(認証基盤の呼び出しを本文に持つ RPC の名前)。 */',
    '  readonly platformCall?: string;',
    '  /** 匿名化の行が持てる(認証基盤の個人データをコミットの後に消すキューのジョブの ID)。 */',
    '  readonly platformJob?: string;',
    '  /** 同一トランザクションで実現される(キューに積まれない)効果の行だけが持つ(kind の語の `in_transaction` の写し)。 */',
    '  readonly inTransaction?: boolean;',
    '}',
    '',
    docComment([
      'このシステムが人手なしで動かすものの**全数**(閉世界)。',
      '',
      'ここに無いジョブ種別を実装が実行してはならず、`source: outbox` の行はハンドラを',
      '持たなければならない。突合は app/src/operation/__tests__/jobs/job-catalog.test.ts。',
    ]),
    `export const JOBS: readonly JobDecl[] = ${renderLiteral(jobLiteral(catalog))};`,
    '',
  ].join('\n');
}

/**
 * ジョブカタログから実装側の期待表を生成するジェネレーター。
 * 出力は app/src/domain/generated/jobs.ts の 1 ファイル(全置換)。
 */
export const jobExpectationsGenerator: DocGenerator = {
  id: 'code-jobs',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const catalog = ctx.jobs?.catalog;
    if (catalog === undefined || catalog === null) return [];
    return [{ file: outputFile(ctx.roots), content: renderFile(catalog), wholeFile: true }];
  },
};
