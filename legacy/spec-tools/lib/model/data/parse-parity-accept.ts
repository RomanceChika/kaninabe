/**
 * data_table の `parity_accepts`(構造の突合の照らしが赤にする形を、その表で**理由と試験の ID つきで**受け入れる行)の読み取り(点検 26 回目 A26-1)。
 *
 * ## なぜ宣言なのか
 *
 * 以前は受け入れの表が突合の部品(製品の試験の木の構造の突合の置き場にある `invariant-edge-accepts.ts` / `trigger-advisory.ts` /
 * `isolation-gate.ts`)の中に、製品の表名・関数名・不変条件 ID を文字列で持っていた。突合の本体は題材の通し実行(samples:db)でも回るので、
 * 題材が宣言しない名前を本文が名指すことになり、分類(`db-parity.ts`)が data-table-parity ごと題材から外した(rc 0 のまま)。受け入れを
 * 表の宣言に置けば、突合は生成物(`dataTableParityAccepts`)を読むだけになり、どの製品・題材でも同じ本文が回る。
 *
 * ## 既存の宣言を広げなかった理由(原則 8)
 *
 * - `erasure_accept` は T24 の消去の連鎖の受け入れで、名指すのが参照の列と個人列である。突合の受け入れは不変条件・端・関数を名指すので
 *   形が合わず、混ぜると T24 の閉じた形が開く。
 * - `triggers[]` の要素に載せる案は、端の受け入れ(執行点が**無い**ことの受け入れ = 載せる要素が無い)と、宣言の外で生成されるトリガ
 *   (未ログインの作成の天井 `ddl-ceiling-triggers.ts`。access_spec の abuse が正)の受け入れを書けない。
 *
 * そこで 3 つの照らし(不変条件の書き込みの端・トリガの advisory lock・隔離の門)を 1 つの宣言 `check:` で束ねた。表はこのファイルの表である。
 * ここで見るのは 1 ファイルの中で閉じる形だけで、試験の ID が登録簿にあるか・端や関数が実在するかは突合が見る(要らなくなった受け入れも赤)。
 */

import type { SpecReporter } from '../parse-common.js';
import { identifierField } from '../sql-fields.js';
import { eachRecord, type YamlReader } from '../yaml-reader.js';
import { PARITY_ACCEPT_CHECKS, type DataParityAccept, type DataParityAcceptCheck } from './types-parity-accept.js';

/** 書き方。 */
const SUGGESTION =
  'parity_accepts は "- check: invariant_edge / invariant / edge / reason / test" か ' +
  '"- check: trigger_advisory | isolation_gate / function / invariant / reason / test" のリストで書く';

/** 要素に書けるキー。 */
const KEYS: readonly string[] = ['check', 'invariant', 'edge', 'function', 'reason', 'test'];

/** 不変条件 ID の形。 */
const INVARIANT_ID = /^INV-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

/** 試験の ID の形。 */
const TEST_ID = /^TC-[A-Z0-9_]+(?:-[A-Z0-9_]+)*$/;

/**
 * `parity_accepts` を読む。
 *
 * @param root フロントマターの読み手
 * @param reporter 違反の記録先
 * @returns 受け入れの並び(無ければ空)
 */
export function parseParityAccepts(root: YamlReader, reporter: SpecReporter): readonly DataParityAccept[] {
  const items = root.optionalList('parity_accepts', SUGGESTION);
  const accepts: DataParityAccept[] = [];
  eachRecord(items, 'parity_accepts', reporter, 'check / invariant / reason / test と、edge か function を持つ要素として書く', (reader) => {
    reader.rejectUnknownKeys(KEYS, 'parity_accepts の要素', `書けるのは ${KEYS.join(' / ')} だけ。綴り違いなら直す`);
    const accept = readAccept(reader, reporter);
    if (accept !== null) accepts.push(accept);
  });
  reporter.settleRows(items.length, accepts.length);
  return accepts;
}

/**
 * `parity_accepts` を DataTableSpec の欄の形で読む(無ければ欄ごと省く)。
 *
 * @param root フロントマターの読み手
 * @param reporter 違反の記録先
 * @returns `{ parityAccepts }` か空
 */
export function parityAcceptsField(root: YamlReader, reporter: SpecReporter): { readonly parityAccepts?: readonly DataParityAccept[] } {
  const parityAccepts = parseParityAccepts(root, reporter);
  return parityAccepts.length === 0 ? {} : { parityAccepts };
}

/** 要素 1 つを読む(形が崩れていれば違反を記録して null)。 */
function readAccept(reader: YamlReader, reporter: SpecReporter): DataParityAccept | null {
  const check = reader.requiredString('check', `check に照らしの種類を書く(${PARITY_ACCEPT_CHECKS.join(' / ')})`);
  const invariant = reader.requiredString('invariant', 'invariant に受け入れの根拠の不変条件 ID を書く');
  const reason = reader.requiredString('reason', 'reason に受け入れる理由を書く(空は通らない)');
  const test = reader.requiredString('test', 'test に理由を示す試験の ID を書く(この表の test_cases で spec_ids にその不変条件を持つもの)');
  if (check === null || invariant === null || reason === null || test === null) return null;
  if (!(PARITY_ACCEPT_CHECKS as readonly string[]).includes(check)) {
    reporter.error(reader.pointer('check'), `parity_accepts の check ${check} は値域(${PARITY_ACCEPT_CHECKS.join(' / ')})にありません`, SUGGESTION, { check });
    return null;
  }
  const kind = check as DataParityAcceptCheck;
  const shape = shapeProblem({ kind, invariant, reason, test, hasEdge: reader.has('edge'), hasFunction: reader.has('function') });
  if (shape !== null) {
    reporter.error(reader.pointer(shape.key), `parity_accepts(${kind} / ${invariant})の ${shape.message}`, SUGGESTION, { check: kind, invariant });
    return null;
  }
  if (kind === 'invariant_edge') {
    const edge = reader.requiredString('edge', 'edge に受け入れる書き込みの端を書く(例: update of {列})');
    return edge === null || edge.trim() === '' ? null : { check: kind, invariant, edge: edge.trim(), reason, test };
  }
  const name = identifierField(reader, reporter, 'function', reader.requiredString('function', 'function に受け入れるトリガ関数の名前を書く'));
  return name === null ? null : { check: kind, invariant, function: name, reason, test };
}

/** 形の食い違い(どのキーの何か。無ければ null)。 */
function shapeProblem(args: {
  readonly kind: DataParityAcceptCheck;
  readonly invariant: string;
  readonly reason: string;
  readonly test: string;
  readonly hasEdge: boolean;
  readonly hasFunction: boolean;
}): { readonly key: string; readonly message: string } | null {
  if (!INVARIANT_ID.test(args.invariant)) return { key: 'invariant', message: 'invariant が不変条件 ID の形(INV-…)ではありません' };
  if (args.reason.trim() === '') return { key: 'reason', message: 'reason が空です' };
  if (!TEST_ID.test(args.test)) return { key: 'test', message: 'test が試験の ID の形(TC-…)ではありません' };
  if (args.kind === 'invariant_edge') {
    if (args.hasFunction) return { key: 'function', message: 'function は書けません(invariant_edge は edge で端を名指す)' };
    if (!args.hasEdge) return { key: 'edge', message: 'edge がありません' };
    return null;
  }
  if (args.hasEdge) return { key: 'edge', message: `edge は書けません(${args.kind} は function で関数を名指す)` };
  if (!args.hasFunction) return { key: 'function', message: 'function がありません' };
  return null;
}
