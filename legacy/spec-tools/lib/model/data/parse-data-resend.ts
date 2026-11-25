/**
 * data_table の `resend`(作成の冪等な再送で既存の行を返すか)のパーサー(T0)。
 *
 * ここが見るのは**形**だけである —— マッピングであること・`returns_existing` が真偽値で必ずあること・
 * `creator` が「返す」ときだけ書かれること(書かなければ監査ログの実行者で確かめる。点検 20 回目 B20-1)・余計なキーが無いこと。
 * `creator` の列が作成の RPC で実行者そのものに埋まるかは、本文の組み立てと同じ写像で
 * T6(単発の作成)と Y12(保存点の錨)が見る。
 */

import type { SpecReporter } from '../parse-common.js';
import { asRecord } from '../parse-common.js';
import { YamlReader } from '../yaml-reader.js';
import { identifierField } from '../sql-fields.js';
import type { DataResendDecl } from './types-resend.js';

/** 要素に書けるキー(これ以外は書けない)。 */
const RESEND_KEYS = ['returns_existing', 'creator'] as const;

/** 書き方の案内(どちらの形も示す)。 */
export const RESEND_SUGGESTION =
  'resend は "{ returns_existing: true, creator: {作成の RPC が実行者で埋める列} }"(再送で返すのは作成者が実行者の行だけ)・' +
  '"{ returns_existing: true }"(作成者の欄が無い表。返すのは監査ログの実行者が今回の実行者と一致する行だけ)・' +
  '"{ returns_existing: false }"(再送で既存の行を返さず、同じ id があれば競合 UC409)のどれかで書く';

/**
 * 表 1 枚の `resend` を読む。
 *
 * @param root 表のフロントマターの読み取り器
 * @param reporter 違反の記録先
 * @returns 読めた宣言(書かなければ・読めなければ undefined)
 */
export function parseResend(root: YamlReader, reporter: SpecReporter): DataResendDecl | undefined {
  if (!root.has('resend')) return undefined;
  const pointer = root.pointer('resend');
  const record = asRecord(root.raw('resend'));
  if (record === null) {
    reporter.error(pointer, 'resend はマッピングで書きます', RESEND_SUGGESTION, { value: String(root.raw('resend')) });
    reporter.dropRows();
    return undefined;
  }
  const reader = new YamlReader(record, pointer, reporter);
  reader.rejectUnknownKeys(RESEND_KEYS, 'resend', RESEND_SUGGESTION);
  const returnsExisting = reader.requiredBoolean('returns_existing', RESEND_SUGGESTION);
  const written = reader.optionalString('creator', RESEND_SUGGESTION);
  // 書かれているのに文字列として読めなかった(型違い)ときは、読めなかった宣言として落とす
  // (「作成者が無い」と読み替えて別の指摘を重ねない)。
  const creator =
    written === undefined ? (reader.has('creator') ? null : undefined) : identifierField(reader, reporter, 'creator', written);
  const decl = settle(returnsExisting, creator, reader, reporter);
  if (decl === null) {
    reporter.dropRows();
    return undefined;
  }
  return { ...decl, location: reporter.location(pointer) };
}

/** 真偽値と作成者の欄の組み合わせを確かめる(返さないなら作成者は書けない。返すなら作成者は任意 = 無ければ監査ログの実行者)。 */
function settle(
  returnsExisting: boolean | null,
  creator: string | null | undefined,
  reader: YamlReader,
  reporter: SpecReporter,
): Omit<DataResendDecl, 'location'> | null {
  if (returnsExisting === null || creator === null) return null;
  if (!returnsExisting && creator !== undefined) {
    reporter.error(
      reader.pointer('creator'),
      'resend.returns_existing: false に creator は書けません',
      '再送で既存の行を返さないなら、作成者の欄は使われない。creator を消す(返すなら returns_existing: true にする)',
      { returns_existing: 'false', creator },
    );
    return null;
  }
  return creator === undefined ? { returnsExisting } : { returnsExisting, creator };
}
