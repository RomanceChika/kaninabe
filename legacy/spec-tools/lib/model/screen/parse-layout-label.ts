/**
 * レイアウト部品の表示名(`label`)の読み取り。
 *
 * `- page_title: { label: 催し一覧 }` のように、部品のマッピングの中に入れ子スロットと
 * 並べて書く。label は部品の属性であってスロットではないため、parse-layout の collectSlots に
 * 渡す前にここで抜く(抜かないと「label はリストかマッピングで書きます」という嘘の指摘になる)。
 * スロット名としては予約語になる(S6 の値域の外)。
 */

import { asRecord, type SpecReporter } from '../parse-common.js';

/** 部品の表示名のキー。 */
export const LABEL_KEY = 'label';

const LABEL_SUGGESTION =
  'label は UI の表示名(画面の見出し・部品名)を空でない文字列で書く。例: label: 催し一覧。' +
  '表示名を決めていないならキーごと消す(label は任意。無ければ従来どおり文言は実装の自由)';

/**
 * 部品のマッピングから `label:` を取り出し、残り(入れ子スロット)と分ける。
 *
 * @param value 部品名キーの値(入れ子 layout・label を持つマッピング)
 * @param pointer 違反位置に使う YAML パス
 * @param reporter 違反の記録先
 * @returns label(妥当な宣言があるときだけ)と、label を除いた残りのマッピング。
 *   マッピングとして読めない値は rest=null で返し、指摘は collectSlots に任せる
 */
export function splitLabel(
  value: unknown,
  pointer: string,
  reporter: SpecReporter,
): { readonly label?: string; readonly rest: Readonly<Record<string, unknown>> | null } {
  const record = asRecord(value);
  if (record === null || !(LABEL_KEY in record)) return { rest: record };
  const { [LABEL_KEY]: raw, ...rest } = record;
  if (typeof raw !== 'string' || raw.trim() === '') {
    reporter.error(`${pointer}.${LABEL_KEY}`, `${pointer}.${LABEL_KEY} が表示名として読めません`, LABEL_SUGGESTION, {
      value: String(raw),
    });
    return { rest };
  }
  return { label: raw, rest };
}
