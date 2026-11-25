/**
 * 拡張候補の台帳のパーサー(W5 のスキーマ適合の部分)。
 *
 * ここで見るのは 1 ファイルの中で閉じる形だけである —— 必須キー・`id` の形と一意・`rules` の形・`status` の値域・
 * `since` の日付の形。**未知のキーは書けない**(`reason` のような汎用の理由欄を足せないようにするため。
 * 理由つきの受け入れの口は、この台帳に作らない)。検査 ID の実在・`done` との整合・`rules` の重なりは、
 * 警告の実際の出方を見る検証器(`verifiers/w5-extension-ledger.ts`)が見る。
 */

import type { SpecReporter } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import type { ParseResult } from '../parse-common.js';
import {
  EXTENSION_SCOPES,
  EXTENSION_STATUSES,
  type ExtensionCandidate,
  type ExtensionLedger,
  type ExtensionScope,
  type ExtensionStatus,
} from './types.js';

/** 候補の識別子の形(`X-` + ケバブケース)。 */
const CANDIDATE_ID = /^X-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** 検査 ID の形(英大文字 1〜2 字 + 数字)。 */
export const VERIFIER_ID_SHAPE = /^[A-Z]{1,2}[0-9]{1,2}$/;

/** 日付の形(`YYYY-MM-DD`)。 */
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** トップレベルに書けるキー。 */
const LEDGER_KEYS: readonly string[] = ['candidates'];

/** 候補 1 行に書けるキー。 */
const CANDIDATE_KEYS: readonly string[] = ['id', 'statement', 'rules', 'scope', 'status', 'since', 'ref'];

const ROW_SUGGESTION =
  'candidates は "- id / statement / rules / status / since / ref" のリストで書く(extension-candidates.md の冒頭)';

/** 知らないキーを見つけたときの直し方。理由欄を足そうとした場合の行き先も言う。 */
const UNKNOWN_KEY_HINT =
  `書けるのは ${CANDIDATE_KEYS.join(' / ')} だけ。綴り違いを直す(理由つきの受け入れの口はこの台帳に作らない。` +
  '仕組みを変えるべきでない例外は、検査ごとの既存の受け入れの宣言で書く)';

/**
 * 台帳 1 ファイル分のフロントマターをパースする。
 *
 * @param data フロントマターのマッピング
 * @param reporter 違反の記録先(Finding の location.file を持つ)
 * @returns 構築した台帳と違反
 */
export function parseExtensionLedger(
  data: Readonly<Record<string, unknown>>,
  reporter: SpecReporter,
): ParseResult<ExtensionLedger> {
  const root = new YamlReader(data, '', reporter);
  root.rejectUnknownKeys(LEDGER_KEYS, '拡張候補の台帳', `書けるのは ${LEDGER_KEYS.join(' / ')} だけ`);
  const items = root.requiredList('candidates', ROW_SUGGESTION) ?? [];
  const candidates: ExtensionCandidate[] = [];
  const ids = new Set<string>();
  eachRecord(items, 'candidates', reporter, ROW_SUGGESTION, (item, index) => {
    item.rejectUnknownKeys(CANDIDATE_KEYS, `candidates[${index}]`, UNKNOWN_KEY_HINT);
    const candidate = buildCandidate(item, index, reporter);
    if (candidate === null) return;
    if (ids.has(candidate.id)) {
      reporter.error(
        `candidates[${index}].id`,
        `候補 ${candidate.id} が重複しています`,
        '重複した行を消すか、id を分ける',
        { id: candidate.id },
      );
      return;
    }
    ids.add(candidate.id);
    candidates.push(candidate);
  });
  return { value: { candidates, location: reporter.location() }, findings: reporter.findings() };
}

/** 候補 1 行を読む。必須の欄が欠けた行は落とす(突合の鍵が壊れるため)。 */
function buildCandidate(item: YamlReader, index: number, reporter: SpecReporter): ExtensionCandidate | null {
  const id = item.requiredString('id', 'id に X- 接頭辞のケバブケース(例: X-proof-worlds)を書く');
  const statement = item.requiredString('statement', 'statement に、何が書けない・組めないかを 1 文で書く');
  const rules = item.requiredStringList('rules', 'rules に、この候補に当たる検査の ID(例: [T8, T11])を並べる', false);
  const scopeText = item.optionalString('scope', `scope は ${EXTENSION_SCOPES.join(' / ')} のどれかを書く(絞らないなら書かない)`);
  const status = item.requiredString('status', `status を ${EXTENSION_STATUSES.join(' / ')} から書く`);
  const since = item.requiredString('since', 'since に起票の日付を引用符で囲んで書く(例: "2026-10-03")');
  const ref = item.requiredString('ref', 'ref に、経緯を辿れる場所(BACKLOG の行・拡張トリアージの文書)を書く');
  if (id === null || statement === null || rules === null || status === null || since === null || ref === null) return null;

  const base = `candidates[${index}]`;
  let valid = true;
  if (!CANDIDATE_ID.test(id)) {
    reporter.error(`${base}.id`, `id ${id} が X- 接頭辞のケバブケースではありません`, 'X-proof-worlds のように X- で始めて小文字とハイフンで書く', { id });
    valid = false;
  }
  for (const rule of rules) {
    if (VERIFIER_ID_SHAPE.test(rule)) continue;
    reporter.error(`${base}.rules`, `rules の ${rule} が検査 ID の形ではありません`, '検査 ID(T8 のように英大文字 1〜2 字と数字)を書く', { id, rule });
    valid = false;
  }
  const scope = scopeText !== undefined && isScope(scopeText) ? scopeText : undefined;
  if (scopeText !== undefined && scope === undefined) {
    reporter.error(`${base}.scope`, `scope ${scopeText} は値域にありません`, `${EXTENSION_SCOPES.join(' / ')} のどれかに直す(絞らないなら scope を書かない)`, { id, scope: scopeText });
    valid = false;
  }
  if (!isStatus(status)) {
    reporter.error(`${base}.status`, `status ${status} は値域にありません`, `${EXTENSION_STATUSES.join(' / ')} のどれかに直す`, { id, status });
    valid = false;
  }
  if (!DATE_SHAPE.test(since)) {
    reporter.error(`${base}.since`, `since ${since} が YYYY-MM-DD の形ではありません`, '起票の日付を YYYY-MM-DD で書く', { id, since });
    valid = false;
  }
  if (!valid || !isStatus(status)) return null;
  const location = reporter.location(`candidates.${id}`);
  const fields = { id, statement, rules, status, since, ref, location };
  return scope === undefined ? fields : { ...fields, scope };
}

/** 文字列が絞りの鍵の値域にあるか。 */
function isScope(value: string): value is ExtensionScope {
  return (EXTENSION_SCOPES as readonly string[]).includes(value);
}

/** 文字列が状態の値域にあるか。 */
function isStatus(value: string): value is ExtensionStatus {
  return (EXTENSION_STATUSES as readonly string[]).includes(value);
}
