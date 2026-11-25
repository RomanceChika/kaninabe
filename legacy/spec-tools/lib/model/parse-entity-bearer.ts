/**
 * 欄の `bearer`(持っていれば効く値の宣言)の読み取り。
 *
 * 形だけを見る: `string` の欄で `supplied_by: db`(値は DB の列の既定値が CSPRNG で作る)・`format` と併記しない・
 * `max_length` が生成する値(43 字)を入れられる・寿命の宣言が**ちょうど 1 通り**(`expires_at` と `used_at` の対か、`reusable: 理由`)。
 * 名指した欄が同じ集約の `datetime` として実在するかは R16 が見る(全部の欄を読み終えてからでないと分からない)。
 * 純関数であり、違反は `reporter` に記録して `undefined` を返す。
 */

import { BEARER_KEYS, BEARER_LENGTH } from '../kernel/bearer.js';
import type { FieldFormat } from '../kernel/url-format.js';
import { asRecord, type SpecReporter } from './parse-common.js';
import type { BearerDecl, FieldType, SuppliedBy } from './types-entity.js';
import { YamlReader } from './yaml-reader.js';

/** `bearer` の書き方の案内。 */
const BEARER_SUGGESTION =
  'bearer は寿命を宣言する。短期で失効して使い切りなら "bearer: { expires_at: {datetime の欄}, used_at: {datetime の欄} }"(同じ集約の欄を名指す)、' +
  '使い回す設計なら "bearer: { reusable: 理由 }"(受け入れた危険として毎回 warning で名指す)。値は DB の列の既定値が CSPRNG で作る(UUID は使わない)';

/** 欄の宣言のうち、`bearer` の整合を見るのに要るもの。 */
export interface BearerContext {
  readonly type: FieldType;
  readonly suppliedBy: SuppliedBy | undefined;
  readonly format: FieldFormat | undefined;
  readonly maxLength: number | undefined;
}

/** 違反を記録して undefined を返す。 */
function reject(reporter: SpecReporter, pointer: string, message: string, suggestion: string, counterexample?: Readonly<Record<string, string>>): undefined {
  reporter.error(pointer, message, suggestion, counterexample);
  return undefined;
}

/** 欄の宣言との整合(型・供給元・書式・長さ)。直すべき違反を記録し、読み続けてよいなら true。 */
function fieldFits(reporter: SpecReporter, pointer: string, context: BearerContext): boolean {
  if (context.type.kind !== 'string') {
    reject(reporter, pointer, `bearer は string の欄にだけ書けます(この欄は ${context.type.kind} です)`, 'bearer の値は文字列(base64url の 43 字)。type: string にする', { type: context.type.kind });
    return false;
  }
  if (context.suppliedBy !== 'db') {
    reject(
      reporter,
      pointer,
      'bearer の欄は supplied_by: db を宣言します(値を作るのは DB の列の既定値で、入力にも実行者にも現れません)',
      'supplied_by: db を書き、data_table の defaults に CSPRNG の式を書く(式の綴りは R16 が示す)。アプリが乱数で作って渡す形は、強さを仕組みが保証できない',
    );
    return false;
  }
  if (context.format !== undefined) {
    reject(reporter, pointer, `bearer の欄に format: ${context.format} は併記できません`, 'bearer の値は不透明な乱数で、URL や本文ではない。format を消す');
    return false;
  }
  if (context.maxLength === undefined || context.maxLength < BEARER_LENGTH) {
    reject(
      reporter,
      pointer,
      `bearer の欄の max_length は ${BEARER_LENGTH} 以上にします(${context.maxLength === undefined ? '書かれていません' : `${context.maxLength} と書かれています`})`,
      `生成する値は 32 バイトの CSPRNG を base64url にした ${BEARER_LENGTH} 字。max_length を ${BEARER_LENGTH} 以上にする`,
      { max_length: String(context.maxLength) },
    );
    return false;
  }
  return true;
}

/**
 * 欄の `bearer` を読む。
 *
 * @param reader 欄の読み取り口
 * @param reporter 違反の記録先
 * @param context 同じ欄の型・供給元・書式・長さ(整合の検査)
 * @returns 宣言があり正しければ宣言。無い・正しくないなら undefined
 */
export function readBearer(reader: YamlReader, reporter: SpecReporter, context: BearerContext): BearerDecl | undefined {
  if (!reader.has('bearer')) return undefined;
  const pointer = reader.pointer('bearer');
  const record = asRecord(reader.raw('bearer'));
  if (record === null) return reject(reporter, pointer, 'bearer はマッピングで書きます', BEARER_SUGGESTION);
  const body = new YamlReader(record, pointer, reporter);
  body.rejectUnknownKeys(BEARER_KEYS, 'bearer', BEARER_SUGGESTION);
  if (Object.keys(record).some((key) => !BEARER_KEYS.some((allowed) => allowed === key))) return undefined;
  if (!fieldFits(reporter, pointer, context)) return undefined;
  const location = reporter.location(pointer);
  const reusable = body.optionalString('reusable', '使い回しを受け入れる理由を文字列で書く(例: reusable: 何人でも入れる窓口の設計のため)');
  const expiresAt = body.optionalString('expires_at', 'expires_at は失効の時刻を持つ datetime の欄の名前を書く');
  const usedAt = body.optionalString('used_at', 'used_at は使った時刻を持つ datetime の欄の名前を書く');
  if (reusable !== undefined) {
    if (expiresAt !== undefined || usedAt !== undefined) {
      return reject(reporter, pointer, 'bearer の reusable と expires_at / used_at は併記できません(使い回すのか、失効して使い切りなのか、宣言から 1 つに決まりません)', BEARER_SUGGESTION);
    }
    if (reusable.trim() === '') {
      return reject(reporter, body.pointer('reusable'), 'bearer の reusable の理由が空です(理由の無い受け入れは、寿命を宣言しないことと同じです)', 'なぜ使い回してよいのかを具体的に書く。短期で使い切りにできるなら expires_at と used_at を宣言する');
    }
    return { kind: 'reusable', reason: reusable, location };
  }
  if (expiresAt === undefined || usedAt === undefined) {
    return reject(
      reporter,
      pointer,
      `bearer に寿命の宣言がありません(${expiresAt === undefined && usedAt === undefined ? 'expires_at と used_at のどちらも' : expiresAt === undefined ? 'expires_at が' : 'used_at が'}ありません)`,
      BEARER_SUGGESTION,
    );
  }
  return { kind: 'expiring', expiresAt, usedAt, location };
}
