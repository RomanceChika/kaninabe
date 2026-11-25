/**
 * 仕様モデルからテストケース ID 台帳のエントリを作る(仕様種ごとの写し取り)。
 *
 * 台帳の索引構造(`testcase/registry.ts`)と「どの仕様種がどう宣言しているか」をここで分ける。
 * 索引は仕様の型を知らず、この 1 ファイルだけが全仕様種の型を知る
 * (逆に lib/trace と lib/query が互いの型を知る必要は無くなる)。
 *
 * **仕様種を増やすときの手順は 3 つで閉じる。**
 * 1. `testcase/types.ts` の `SpecKind` と `testcase/registry.ts` の `SPEC_KIND_LIST` に 1 語ずつ足す。
 * 2. このファイルに `collect{仕様種}Entries` を 1 本書く(`toEntry` に宣言を渡すだけ)。
 * 3. `TcSources` にモデルを 1 つ足し、`collectTcEntries` の配列に 1 行足す。
 *
 * 検査側(A6 / A9 / Q6)と CLI の変更は要らない。検査は台帳インターフェースしか見ないため。
 */

import type { ActionSpecModel } from '../model/trace/types.js';
import type { ActionTestCase, RetiredTcId, SpecKind, TcRegistryEntry } from '../testcase/types.js';
import type { OwnedTcRegistryEntry } from '../testcase/index.js';
import type { QuerySpecModel } from '../model/query/types.js';
import type { ScreenSpecModel } from '../model/screen/types.js';
import type { DataTableSpecModel } from '../model/data/types.js';
import type { NotificationSpecModel } from '../model/notification/types.js';
import type { JobSpecModel } from '../model/job/types.js';
import type { AuthSpecModel } from '../model/auth/types.js';
import type { GuaranteeSpecModel } from '../model/guarantee/types.js';
import type { ExternalSpecModel } from '../model/external/types.js';
import type { UsecaseSpecModel } from '../model/usecase/types.js';

/**
 * 台帳の材料。仕様種ごとに読み込み済みモデルを渡す。
 *
 * どれも省略可能なのは、その仕様を持たないリポジトリ(まだ書いていない / ディレクトリが無い)
 * でも台帳が壊れずに作れるようにするため。省略は「その種の宣言が 0 件」と同じ扱いになる。
 */
export interface TcSources {
  readonly actions?: ActionSpecModel | null;
  readonly queries?: QuerySpecModel | null;
  readonly screens?: ScreenSpecModel | null;
  readonly dataTables?: DataTableSpecModel | null;
  readonly notifications?: NotificationSpecModel | null;
  readonly jobs?: JobSpecModel | null;
  readonly auth?: AuthSpecModel | null;
  readonly guarantees?: GuaranteeSpecModel | null;
  /** 仕組みの保証台帳(`framework/guarantees.md`)。載せたエントリには `owner: 'framework'` が付く(製品の台帳と同じ索引で A9 が台帳をまたぐ重複を拾う)。 */
  readonly frameworkGuarantees?: GuaranteeSpecModel | null;
  readonly external?: ExternalSpecModel | null;
  readonly usecases?: UsecaseSpecModel | null;
}

/**
 * 全仕様種の `test_cases` を 1 本のエントリ列にする。
 *
 * @param sources 仕様種ごとの読み込み済みモデル
 * @returns 台帳に載せるエントリ(仕様種ごとに、その中では宣言順)
 */
export function collectTcEntries(sources: TcSources): TcRegistryEntry[] {
  return [
    ...collectActionEntries(sources.actions),
    ...collectQueryEntries(sources.queries),
    ...collectScreenEntries(sources.screens),
    ...collectDataTableEntries(sources.dataTables),
    ...collectNotificationEntries(sources.notifications),
    ...collectJobEntries(sources.jobs),
    ...collectAuthEntries(sources.auth),
    ...collectGuaranteeEntries(sources.guarantees),
    ...collectFrameworkGuaranteeEntries(sources.frameworkGuarantees),
    ...collectExternalEntries(sources.external),
    ...collectUsecaseEntries(sources.usecases),
  ];
}

/** action_spec の test_cases を台帳エントリに写す。 */
function collectActionEntries(model: ActionSpecModel | null | undefined): TcRegistryEntry[] {
  if (model == null) return [];
  return model.actions.flatMap((action) =>
    action.testCases.map((testCase) =>
      toEntry(testCase, 'action_spec', action.id, action.location.file),
    ),
  );
}

/**
 * action_spec が `retired:` で欠番にしたテストケース ID を集める(A9 の再利用検出の材料)。
 *
 * 台帳のエントリ(`TcRegistryEntry`)ではなく別枠で返す — 欠番は「今宣言されているもの」
 * ではないため、`entries` / `ofKind` / 通常の `duplicates()` の母集合に混ぜてはならない
 * (混ぜると A6 の orphan 判定や ofKind の集計が欠番の分だけ狂う)。
 *
 * @param model 読み込み済みの action_spec モデル
 * @returns 欠番 ID の宣言(action_spec を横断した列)
 */
export function collectRetiredTcIds(model: ActionSpecModel | null | undefined): RetiredTcId[] {
  if (model == null) return [];
  return model.actions.flatMap((action) =>
    action.retired.map((ref) => ({ tcId: ref.id, location: ref.location })),
  );
}

/** query_spec の test_cases を台帳エントリに写す。 */
function collectQueryEntries(model: QuerySpecModel | null | undefined): TcRegistryEntry[] {
  if (model == null) return [];
  return model.queries.flatMap((query) =>
    query.testCases.map((testCase) =>
      toEntry(testCase, 'query_spec', query.id, query.location.file),
    ),
  );
}

/** screen_spec の test_cases を台帳エントリに写す。 */
function collectScreenEntries(model: ScreenSpecModel | null | undefined): TcRegistryEntry[] {
  if (model == null) return [];
  return model.screens.flatMap((screen) =>
    screen.testCases.map((testCase) =>
      toEntry(testCase, 'screen_spec', screen.id, screen.location.file),
    ),
  );
}

/** data_table の test_cases を台帳エントリに写す。 */
function collectDataTableEntries(model: DataTableSpecModel | null | undefined): TcRegistryEntry[] {
  if (model == null) return [];
  return model.tables.flatMap((table) =>
    table.testCases.map((testCase) => toEntry(testCase, 'data_table', table.id, table.location.file)),
  );
}

/** notification_spec の test_cases を台帳エントリに写す。 */
function collectNotificationEntries(
  model: NotificationSpecModel | null | undefined,
): TcRegistryEntry[] {
  const catalog = model?.catalog;
  if (catalog == null) return [];
  return catalog.testCases.map((testCase) =>
    toEntry(testCase, 'notification_spec', catalog.id, catalog.location.file),
  );
}

/** job_spec の test_cases を台帳エントリに写す。 */
function collectJobEntries(model: JobSpecModel | null | undefined): TcRegistryEntry[] {
  const catalog = model?.catalog;
  if (catalog == null) return [];
  return catalog.testCases.map((testCase) =>
    toEntry(testCase, 'job_spec', catalog.id, catalog.location.file),
  );
}

/** auth_spec の test_cases を台帳エントリに写す。 */
function collectAuthEntries(model: AuthSpecModel | null | undefined): TcRegistryEntry[] {
  const flow = model?.flow;
  if (flow == null) return [];
  return flow.testCases.map((testCase) =>
    toEntry(testCase, 'auth_spec', flow.id, flow.location.file),
  );
}

/** guarantee_spec の test_cases を台帳エントリに写す。 */
function collectGuaranteeEntries(model: GuaranteeSpecModel | null | undefined): TcRegistryEntry[] {
  const catalog = model?.catalog;
  if (catalog == null) return [];
  return catalog.testCases.map((testCase) =>
    toEntry(testCase, 'guarantee_spec', catalog.id, catalog.location.file),
  );
}

/** 仕組みの保証台帳の test_cases を、持ち主つきの台帳エントリに写す。 */
function collectFrameworkGuaranteeEntries(model: GuaranteeSpecModel | null | undefined): OwnedTcRegistryEntry[] {
  const catalog = model?.catalog;
  if (catalog == null) return [];
  return catalog.testCases.map((testCase) => ({
    ...toEntry(testCase, 'guarantee_spec', catalog.id, catalog.location.file),
    owner: 'framework' as const,
  }));
}

/** external_spec の test_cases を台帳エントリに写す(0 件でもよい — 任意宣言のため空配列を返す)。 */
function collectExternalEntries(model: ExternalSpecModel | null | undefined): TcRegistryEntry[] {
  const catalog = model?.catalog;
  if (catalog == null) return [];
  return catalog.testCases.map((testCase) =>
    toEntry(testCase, 'external_spec', catalog.id, catalog.location.file),
  );
}

/** usecase_spec の test_cases を台帳エントリに写す。 */
function collectUsecaseEntries(model: UsecaseSpecModel | null | undefined): TcRegistryEntry[] {
  if (model == null) return [];
  return model.usecases.flatMap((usecase) =>
    usecase.testCases.map((testCase) =>
      toEntry(testCase, 'usecase_spec', usecase.id, usecase.location.file),
    ),
  );
}

/**
 * 宣言 1 件を、宣言元の情報を添えて台帳エントリにする。
 *
 * `test_cases` の形は仕様種をまたいで同じ(query_spec は action_spec と同形式)なので、
 * 写し取りは仕様種ごとに書き分けず、この 1 本を共有する。
 */
function toEntry(
  testCase: ActionTestCase,
  specKind: SpecKind,
  specId: string,
  specFile: string,
): TcRegistryEntry {
  return {
    tcId: testCase.id,
    specKind,
    specId,
    specIds: testCase.specIds,
    implementation: testCase.implementation,
    location: testCase.location,
    specFile,
  };
}
