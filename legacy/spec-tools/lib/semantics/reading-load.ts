/**
 * 受け入れ(人が理由をつけて通したもの)の導出と、仕様ファイル 1 枚あたりの読む量。
 *
 * 受け入れは仕様の宣言から数える —— テーブルの手書き(`handwritten`)・定型に乗らない操作(`runner`)・
 * 操作の確認の上書き(`ux`)・リント違反の受け入れ(`exceptions`)・タスクの受け入れ(`accept:`)・
 * 画面の UX 原則の受け入れ(screen_spec の `ux:`。タスクの受け入れと同じ「受け入れ」の分類)・
 * 時刻の登録をまだしていないジョブの理由(job_spec の `not_scheduled_reason`。同じ分類だが、読み手は開発者)・
 * 雛形に載せない設定の理由(config_spec の `not_in_template_reason`。読み手は開発者)。
 * 分類の表は `reading-class.ts`(要素の種類 → 受け入れ)。章(`face-facts`)も手引きのブロック表も
 * **この関数**から数えるので、数は食い違わない。
 *
 * 純粋関数だけ(意味解析の層)。**アプリの語彙は 1 語も持たない。**
 */

import type { ConfigVariableDecl } from '../model/config/types.js';
import type { DataTableSpec } from '../model/data/types.js';
import type { JobDecl } from '../model/job/types.js';
import type { ScreenSpec } from '../model/screen/types.js';
import type { ActionSpec } from '../model/trace/types.js';
import type { UsecaseSpec } from '../model/usecase/types.js';
import type { ReadingElement } from './reading-class.js';

/** 受け入れの 1 件(人が理由をつけて通したもの)。 */
export interface AcceptItem {
  /** 何を(名前)。 */
  readonly what: string;
  /** 通した理由(仕様の原文)。 */
  readonly reason: string;
  /** 要素の種類(分類の表の鍵)。 */
  readonly element: ReadingElement;
  /** 宣言のある仕様ファイル(リポジトリルート相対)。 */
  readonly file: string;
}

/** 受け入れの種類ごとの一覧(数えられるもの)。 */
export interface AcceptCounts {
  /** 本文が手書きの migration にある執行点(`handwritten`)。 */
  readonly handwritten: readonly AcceptItem[];
  /** 定型に乗らない操作(`runner`)。 */
  readonly manual: readonly AcceptItem[];
  /** タスクの受け入れ(`accept:`)・画面の UX 原則の受け入れ(screen_spec の `ux:`)・時刻の登録をまだしていないジョブの理由・雛形に載せない設定の理由。 */
  readonly accepted: readonly AcceptItem[];
  /** 操作の確認の上書き(`ux`)とリント違反の受け入れ(`exceptions`)。 */
  readonly overrides: readonly AcceptItem[];
}

/** 受け入れの合計。 */
export function acceptTotal(accept: AcceptCounts): number {
  return accept.handwritten.length + accept.manual.length + accept.accepted.length + accept.overrides.length;
}

/** 受け入れを平らな一覧にする(種類の並び順)。 */
export function acceptItems(accept: AcceptCounts): readonly AcceptItem[] {
  return [...accept.handwritten, ...accept.manual, ...accept.accepted, ...accept.overrides];
}

/** テーブル仕様の手書き(CHECK と関数)。 */
function handwrittenOf(tables: readonly DataTableSpec[]): AcceptItem[] {
  return tables.flatMap((table) => [
    ...table.checks.flatMap((check) =>
      check.handwritten === undefined
        ? []
        : [{ what: `${table.table} の CHECK ${check.name}`, reason: check.handwritten, element: 'handwritten.reason' as const, file: table.location.file }],
    ),
    ...table.functions.flatMap((fn) =>
      fn.handwritten === undefined
        ? []
        : [{ what: `${table.table} の関数 ${fn.name}`, reason: fn.handwritten, element: 'handwritten.reason' as const, file: table.location.file }],
    ),
  ]);
}

/** 操作の確認の上書きとリント違反の受け入れ。 */
function overridesOf(actions: readonly ActionSpec[]): AcceptItem[] {
  return actions.flatMap((action) => [
    ...(action.ux?.reason === undefined
      ? []
      : [{ what: `${action.handles.raw} の確認(${action.ux.confirm})`, reason: action.ux.reason, element: 'ux.override.reason' as const, file: action.location.file }]),
    ...action.exceptions.map((exception) => ({
      what: `${action.handles.raw} の ${exception.rule}`,
      reason: exception.reason,
      element: 'lint.exception.reason' as const,
      file: action.location.file,
    })),
  ]);
}

/**
 * 範囲の宣言から、受け入れの種類ごとの一覧を作る。
 *
 * @param actions 範囲の action_spec
 * @param tables 範囲のテーブル仕様
 * @param usecases 範囲のユースケース仕様
 * @param screens 範囲の screen_spec(`ux:` の受け入れ。集約の章のように画面を持たない範囲は空)
 * @param jobs 範囲のジョブ(`not_scheduled_reason` の理由。ジョブの章以外は空)
 * @param variables 範囲の設定(`not_in_template_reason` の理由。設定の章以外は空)
 */
export function acceptCounts(
  actions: readonly ActionSpec[],
  tables: readonly DataTableSpec[],
  usecases: readonly UsecaseSpec[],
  screens: readonly ScreenSpec[],
  jobs: readonly JobDecl[] = [],
  variables: readonly ConfigVariableDecl[] = [],
): AcceptCounts {
  return {
    handwritten: handwrittenOf(tables),
    manual: actions.flatMap((action) =>
      action.runner === undefined
        ? []
        : [{ what: action.handles.raw, reason: action.runner.reason, element: 'runner.reason' as const, file: action.location.file }],
    ),
    accepted: [
      ...usecases.flatMap((usecase) =>
        usecase.accept.map((decl) => ({
          what: decl.kind === 'budget' ? `${usecase.name} の予算 ${decl.metric}` : `${usecase.name} の ${decl.invariant}`,
          reason: decl.reason,
          element: 'accept.reason' as const,
          file: usecase.location.file,
        })),
      ),
      ...screens.flatMap((screen) =>
        screen.ux.map((decl) => ({
          what: `${screen.name} の ${decl.principle}${decl.subject === '' ? '' : ` ${decl.subject}`}`,
          reason: decl.reason,
          element: 'accept.reason' as const,
          file: screen.location.file,
        })),
      ),
      ...jobs.flatMap((job) =>
        job.schedule?.notScheduledReason === undefined
          ? []
          : [{ what: `${job.id} の時刻の登録`, reason: job.schedule.notScheduledReason, element: 'job.not_scheduled_reason' as const, file: job.location.file }],
      ),
      ...variables.flatMap((variable) =>
        variable.notInTemplateReason === undefined
          ? []
          : [{ what: `${variable.id} の雛形`, reason: variable.notInTemplateReason, element: 'config.not_in_template_reason' as const, file: variable.location.file }],
      ),
    ],
    overrides: overridesOf(actions),
  };
}

/** 仕様ファイル 1 枚が持つ、数えられる読む量(ブロック表の 1 行分)。 */
export interface FileLoad {
  /** 公理の本数(不変条件の言明)。 */
  readonly axioms: number;
  /** 理由つきの受け入れの件数。 */
  readonly reasoned: number;
}

/**
 * 仕様ファイル 1 枚が持つ公理の本数と、理由つきの受け入れの件数。
 *
 * @param file 仕様ファイル(リポジトリルート相対)
 * @param invariantFiles 公理の言明が書かれたファイルごとの本数
 * @param accept 受け入れの一覧(全範囲)
 */
export function fileLoad(file: string, invariantFiles: ReadonlyMap<string, number>, accept: readonly AcceptItem[]): FileLoad {
  return { axioms: invariantFiles.get(file) ?? 0, reasoned: accept.filter((item) => item.file === file).length };
}
