/**
 * 索引の要求(query × data_table)— 関係の層の最初の住人の入口。
 *
 * **ここが「この表に要る索引」を決める唯一の入口である。** 読み取りクエリ(`query_spec`)と、表の関数の
 * 本文が引く列(`data_table` の `functions[].lookup`)は別の種類で、どちらの宣言も単独では要る索引を言えない。
 * 以前はこの導出が `lib/query/` にいて `lib/data/` の部品を読み、`lib/data/` の検査(T2)がそれを読んでいた
 * (種類のディレクトリどうしの相互依存)。ここでは 2 つの種類を入力に取り、**型つきの値(`IndexRequirements`)**を
 * 返す。検査(T2)・生成(code-index-expectations・data-table-body)・ハンドブックの索引節は、この値を読む
 * (設計メモ framework-modules §7 の教訓 1: 層の間の約束は名前のついた中間表現にする)。
 *
 * **入力の状態**(`kernel/input-state.ts`): 入力は `CatalogInput`(未選択 / 阻害 / 読込済み)で受ける。
 * 読込済みでない入力は**使わず**、使わなかったことを `gaps` で返す —— 見ていないものを「要らない」と読まない。
 * 0 件の空のカタログは読込済みであり、阻害とは違う。使えない入力の分だけを導かないので、片方が読めない
 * 構成でも、読めた側の要求は出る(`query_spec` が無くても関数の `lookup` の要求は見える、を保つ)。
 * 既存の索引による除外(`expected`)だけは `data_table` が読めないと決められないので、その入力が使えないときは空。
 *
 * 関係の層は前段(`lib/model/**`)・土台(kernel / guard)・意味の葉(`lib/semantics/` の 3 本)だけを読む。
 * 種類のディレクトリの解析(検査・生成)は、値でも型でも読まない(`CLOSURE_BANS` と層の向きが見る)。
 */

import type { GuardServices } from '../../guard/ast.js';
import { availableLoad, catalogInput, type CatalogInput } from '../../kernel/input-state.js';
import type { SpecModel } from '../../model/types.js';
import type { DataTableSpecModel } from '../../model/data/types.js';
import type { QuerySpecModel } from '../../model/query/types.js';
import { excludeDeclared } from './exclusion.js';
import { deriveCandidates } from './index-derivation.js';
import { ceilingIndexRequests, crossIndexRequests, lookupIndexRequests, recreateIndexRequests } from './index-lookup.js';
import type { IndexInputName, IndexRequirementsResult, InputGap } from './types.js';

export type {
  IndexInputName,
  IndexOrigin,
  IndexOriginKind,
  IndexRequirement,
  IndexRequirements,
  IndexRequirementsResult,
  InputGap,
} from './types.js';

/** 導出への入力(ドメイン・ガード式のパースと、2 つの種類の入力の状態)。 */
export interface IndexRequirementsInput {
  readonly domain: SpecModel;
  readonly guards: GuardServices;
  readonly queries: CatalogInput<QuerySpecModel>;
  readonly dataTables: CatalogInput<DataTableSpecModel>;
}

/** 入力が使えないときの欠け(未選択 / 阻害)。使えるなら空。 */
function gapOf(input: IndexInputName, state: CatalogInput<unknown>): readonly InputGap[] {
  if (state.state === 'loaded') return [];
  return [state.state === 'unselected' ? { input, state: 'unselected' } : { input, state: 'blocked', reason: state.reason }];
}

/**
 * 索引の要求を導く(入口)。
 *
 * @param input ドメイン・ガード式のパース・2 つの種類の入力の状態
 * @returns 読めた入力から導いた要求(候補 = 畳み込み後 / 期待 = 既存の索引の除外後)と、使えなかった入力
 */
export function deriveIndexRequirements(input: IndexRequirementsInput): IndexRequirementsResult {
  const queries = input.queries.state === 'loaded' ? input.queries.value.queries : [];
  const dataTables = input.dataTables.state === 'loaded' ? input.dataTables.value : null;
  const lookups = dataTables === null ? [] : [...lookupIndexRequests(dataTables), ...ceilingIndexRequests(dataTables, input.domain), ...crossIndexRequests(dataTables, input.domain), ...recreateIndexRequests(dataTables)];
  const candidates = deriveCandidates(input.domain, input.guards, queries, lookups);
  return {
    requirements: { candidates, expected: dataTables === null ? [] : excludeDeclared(candidates, dataTables) },
    gaps: [...gapOf('queries', input.queries), ...gapOf('data_tables', input.dataTables)],
  };
}

/**
 * 読み込み済みのモデルだけを持つ呼び手(生成器・ハンドブック。`product.md` の `uses` を知らない)のための口。
 * 無い(`undefined`)・`available: false` は、選択を推定せずに「阻害(読み込みが無い / 置き場に仕様が無い)」として扱う。
 * 導出は `deriveIndexRequirements` と同じ(別の導出を持たない)。
 */
export function indexRequirementsOfModels(
  domain: SpecModel,
  guards: GuardServices,
  models: { readonly queries?: QuerySpecModel; readonly dataTables?: DataTableSpecModel },
): IndexRequirementsResult {
  const inputOf = <T extends { readonly available: boolean }>(model: T | undefined): CatalogInput<T> =>
    catalogInput('selected', model === undefined ? undefined : availableLoad(model));
  return deriveIndexRequirements({ domain, guards, queries: inputOf(models.queries), dataTables: inputOf(models.dataTables) });
}
