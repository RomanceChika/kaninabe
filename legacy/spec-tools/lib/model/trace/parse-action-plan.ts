/**
 * action_spec のうち**実行計画にかかわる 2 つの宣言**のパーサー(`computes` / `runner`)。
 *
 * スキーマの正: action-spec-writing.md §computes / §runner。
 * 入口は parse-action.ts で、そこから呼ばれる下位のパーサーである(向きは入口 → ここ。
 * 両者が共有する `{a}.{b}` の分解は葉の parse-action-names.ts にあり、互いを import しない)。
 *
 * ここで見るのは「1 ファイル内で閉じた形式」だけである —— 欄が実在するか・入力に無いか・
 * 書き込みが許される欄かは V18 が、`runner` を宣言していない操作の計画が導出できるかは
 * A15 が見る。
 */

import { ACTION_RUNNER_KINDS } from './types.js';
import type { ActionComputeDecl, ActionComputeReadRef, ActionRunnerDecl } from './types.js';
import { asRecord, SpecReporter } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import { splitQualified } from './parse-action-names.js';
import { codeNameField } from '../sql-fields.js';
import { valueNameProblem } from '../code-names.js';
import { parseComputeExamples, parseComputeShape } from './parse-compute-examples.js';

const COMPUTES_SUGGESTION =
  'computes には「入力に無いが実行時に純関数が決める欄」を "- field: {entity}.{field} / ref: {純関数名}" ' +
  'の形で並べる(無ければ computes ごと書かない。任意で reads / shape / examples)';

/** `computes` の要素に書けるキー。 */
const COMPUTE_KEYS = ['field', 'ref', 'reads', 'shape', 'examples'] as const;

const READS_SUGGESTION =
  'computes[].reads には、その純関数が読む事実を "{entity}.{field}" の形で並べる' +
  '(省略可。書かなければ計算の材料は 1 欄も計画に積まれない)';

const RUNNER_SUGGESTION =
  'runner を書くなら kind(manual)と reason(なぜ生成に乗らないか。日本語 1 文)を両方書く';

/**
 * `computes`(計算値の宣言)を読む。省略可能。
 *
 * ここで見るのは形だけである(`{entity}.{field}` と `ref` が揃っているか)。欄が実在し・入力に
 * 無く・書き込みが許される欄であることは V18 が見る(パーサーは 1 ファイルの中で閉じた形式しか
 * 見ない規約: action-spec-writing.md)。
 */
export function parseComputes(root: YamlReader, reporter: SpecReporter): readonly ActionComputeDecl[] {
  const items = root.optionalList('computes', COMPUTES_SUGGESTION);
  const result: ActionComputeDecl[] = [];
  eachRecord(items, 'computes', reporter, COMPUTES_SUGGESTION, (element, index) => {
    element.rejectUnknownKeys(COMPUTE_KEYS, 'computes の要素', COMPUTES_SUGGESTION);
    const raw = element.requiredString('field', COMPUTES_SUGGESTION);
    // 純関数の名前は生成される import の名前と指定子に置かれるので、文法で閉じる(R17)。
    const ref = codeNameField(element, reporter, 'ref', element.requiredString('ref', COMPUTES_SUGGESTION), valueNameProblem);
    if (raw === null || ref === null) return;
    const parts = splitQualified(raw);
    if (parts === null) {
      reporter.error(`computes[${index}]`, `computes[${index}].field が "{entity}.{field}" の形式ではありません`, COMPUTES_SUGGESTION, {
        value: raw,
      });
      return;
    }
    result.push({
      raw,
      entity: parts.head,
      field: parts.tail,
      ref,
      reads: parseComputeReads(element, reporter, index),
      shape: parseComputeShape(element, reporter, index),
      examples: parseComputeExamples(element, reporter, index),
      location: reporter.location(`computes.${raw}`),
    });
  });
  return result;
}

/**
 * `computes[].reads`(その純関数が読む事実)を読む。省略可能。
 *
 * ここで見るのは形だけである(`{entity}.{field}` になっているか)。欄が実在するか・その集約が
 * その操作の計画から読めるかは **A19** が見る(1 ファイルの中で閉じた形式しか見ない規約)。
 */
function parseComputeReads(
  element: YamlReader,
  reporter: SpecReporter,
  index: number,
): readonly ActionComputeReadRef[] {
  const result: ActionComputeReadRef[] = [];
  for (const raw of element.optionalStringList('reads', READS_SUGGESTION)) {
    const parts = splitQualified(raw);
    if (parts === null) {
      reporter.error(
        `computes[${index}].reads`,
        `computes[${index}].reads の "${raw}" が "{entity}.{field}" の形式ではありません`,
        READS_SUGGESTION,
        { value: raw },
      );
      continue;
    }
    result.push({
      raw,
      entity: parts.head,
      field: parts.tail,
      location: reporter.location(`computes.reads.${raw}`),
    });
  }
  return result;
}

/**
 * `runner`(実行器の選び方)を読む。省略可能 —— 書かなければ生成された実行計画で走る。
 *
 * `reason` はここで必須にする。`ux` の `reason` が V14(検証器)側にあるのは、上書きの件数を
 * A 群の実行状況に出すためだった。こちらは**免除そのもの**であり、理由の無い免除は形として
 * 書けないほうがよい(1 ファイルの中で閉じた形式である)。
 */
export function parseRunner(root: YamlReader, reporter: SpecReporter): ActionRunnerDecl | undefined {
  if (!root.has('runner')) return undefined;
  const record = asRecord(root.raw('runner'));
  if (record === null) {
    reporter.error('runner', 'runner がマッピングになっていません', RUNNER_SUGGESTION);
    return undefined;
  }
  const reader = new YamlReader(record, 'runner', reporter);
  const kind = reader.requiredString('kind', RUNNER_SUGGESTION);
  const reason = reader.requiredString('reason', RUNNER_SUGGESTION);
  if (kind === null || reason === null) return undefined;
  if (!(ACTION_RUNNER_KINDS as readonly string[]).includes(kind)) {
    reporter.error('runner.kind', `runner.kind "${kind}" は値域にありません`, RUNNER_SUGGESTION, { kind });
    return undefined;
  }
  return { kind: kind as ActionRunnerDecl['kind'], reason, location: reporter.location('runner') };
}
