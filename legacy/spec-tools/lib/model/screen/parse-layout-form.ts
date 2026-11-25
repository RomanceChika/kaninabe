/**
 * レイアウト部品の**生成物の宣言**(`kind:` / `action:` / `reads:` / `shows:`。`edit:` / `actions:` は parse-layout-ops.ts)の読み取り(ADR-0015)。
 *
 * `- sample_form: { kind: form, action: sample.create }` / `- sample_table: { kind: table, reads: query-sample-list,
 * shows: [title, venue.name] }` のように、部品のマッピングの中に入れ子スロットと並べて書く。4 つとも部品の属性で
 * あってスロットではないため、parse-layout の collectSlots に渡す前にここで抜く(`label` と同じ扱い。抜かないと
 * 「kind はリストかマッピングで書きます」という嘘の指摘になる)。スロット名としては予約語になる(S6 の値域の外)。
 *
 * ここが担うのは**形として読めるか**(値域・組になっているか・その種類に書いてよい属性か)だけである。
 * 操作が画面の `actions` に居るか・作成か編集か・1 部品 1 操作か(S17)、読みが画面の `reads` に居るか・
 * `returns` が合うか・`shows` の欄が実在するか(S18)は検査器が見る。
 */

import { asArray, type SpecReporter } from '../parse-common.js';
import { BUTTONS_KEY, BUTTONS_SUGGESTION, EDIT_KEY, EDIT_SUGGESTION, readButtons, readEdit } from './parse-layout-ops.js';
import { OPS_KEY, OPS_SUGGESTION, OP_KEY, OP_SUGGESTION, ROW_ACTIONS_KEY, ROW_ACTIONS_SUGGESTION, readPlatformOp, readPlatformOpList } from './parse-layout-platform.js';
import { COMPONENT_KINDS, isComponentKind } from './types.js';
import type { ComponentKind, ScreenRef } from './types.js';

/** 部品の種類のキー。 */
export const KIND_KEY = 'kind';

/** 載せる操作のキー。 */
export const ACTION_KEY = 'action';

/** 出す読みのキー。 */
export const READS_KEY = 'reads';

/** 出す欄のキー。 */
export const SHOWS_KEY = 'shows';

const KIND_SUGGESTION =
  `kind は部品の種類を ${COMPONENT_KINDS.join(' / ')} のどれかで書く(例: kind: form)。` +
  '生成物にしない部品(手書きの部品)は kind ごと書かない — 手書きが既定で、免除の語は無い';

const ACTION_SUGGESTION =
  'action は載せる操作の ID を書く(例: action: sample.create)。' +
  'screen の actions に居る作成(create)か編集(update)の操作で、1 部品 1 操作である';

const READS_SUGGESTION =
  'reads は部品が出す読みの query_spec の ID を 1 つ書く(例: reads: query-sample-list)。' +
  '画面の reads の要素で、kind: table は returns: many・kind: detail / actions は returns: one の読みである';

const SHOWS_SUGGESTION =
  'shows は出す欄の一覧で書く(例: shows: [title, venue.name])。欄は読みの projection か、併読の {併読名}.{欄}。' +
  '省略すると projection の id と ref の欄を除く全欄になる';

/** 属性のキー(`kind` 以外。書いてよい `kind` の判定の母集合)。 */
const ATTRIBUTE_KEYS: readonly string[] = [ACTION_KEY, READS_KEY, SHOWS_KEY, EDIT_KEY, BUTTONS_KEY, OP_KEY, OPS_KEY, ROW_ACTIONS_KEY];

/** `kind` ごとに書いてよい属性(どれが必須で、どれが書けないか)。 */
const ATTRIBUTES: Readonly<Record<ComponentKind, { readonly required: readonly string[]; readonly allowed: readonly string[] }>> = {
  form: { required: [ACTION_KEY], allowed: [ACTION_KEY, READS_KEY] },
  table: { required: [READS_KEY], allowed: [READS_KEY, SHOWS_KEY, EDIT_KEY, BUTTONS_KEY, ROW_ACTIONS_KEY] },
  detail: { required: [READS_KEY], allowed: [READS_KEY, SHOWS_KEY] },
  actions: { required: [READS_KEY, BUTTONS_KEY], allowed: [READS_KEY, BUTTONS_KEY] },
  platform_read: { required: [OP_KEY], allowed: [OP_KEY, SHOWS_KEY, ROW_ACTIONS_KEY] },
  platform_actions: { required: [OPS_KEY], allowed: [OPS_KEY] },
};

/** 組になる属性の suggestion。 */
const SUGGESTIONS: Readonly<Record<string, string>> = {
  [ACTION_KEY]: ACTION_SUGGESTION,
  [READS_KEY]: READS_SUGGESTION,
  [SHOWS_KEY]: SHOWS_SUGGESTION,
  [EDIT_KEY]: EDIT_SUGGESTION,
  [BUTTONS_KEY]: BUTTONS_SUGGESTION,
  [OP_KEY]: OP_SUGGESTION,
  [OPS_KEY]: OPS_SUGGESTION,
  [ROW_ACTIONS_KEY]: ROW_ACTIONS_SUGGESTION,
};

/** `kind` / `action` / `reads` / `shows` / `edit` / `actions` を抜いた結果。 */
export interface SplitForm {
  readonly kind?: ComponentKind;
  readonly actionRefs?: readonly ScreenRef[];
  readonly readRef?: ScreenRef;
  readonly showRefs?: readonly ScreenRef[];
  readonly editRef?: ScreenRef;
  readonly buttonRefs?: readonly ScreenRef[];
  readonly platformOpRef?: ScreenRef;
  readonly platformOpRefs?: readonly ScreenRef[];
  readonly rowActionRefs?: readonly ScreenRef[];
  /** 9 つの属性を除いた残り(入れ子スロット)。 */
  readonly rest: Readonly<Record<string, unknown>> | null;
}

/**
 * 部品のマッピングから `kind:` / `action:` / `reads:` / `shows:` を取り出し、残り(入れ子スロット)と分ける。
 *
 * 書き方の誤りは 3 通りを S0 にする: 値域に無い `kind` / 読めない値 / 組になっていない宣言
 * (`kind` が無いのに他の属性がある・`kind` が要る属性が無い・その `kind` に書けない属性がある)。
 * **組であること**を検査器でなくここで見るのは、組になっていない宣言は「どの操作 / 読みを載せるか」が
 * 読めず、検査器の突合の入力に成り得ないからである。
 *
 * @param record 部品名キーの値(`label` を抜いた後のマッピング。読めなければ null)
 * @param pointer 違反位置に使う YAML パス
 * @param reporter 違反の記録先
 * @returns 読めた属性と、それを除いた残りのマッピング
 */
export function splitForm(
  record: Readonly<Record<string, unknown>> | null,
  pointer: string,
  reporter: SpecReporter,
): SplitForm {
  const keys = [KIND_KEY, ...ATTRIBUTE_KEYS];
  if (record === null || !keys.some((key) => key in record)) return { rest: record };
  const {
    [KIND_KEY]: rawKind,
    [ACTION_KEY]: rawAction,
    [READS_KEY]: rawReads,
    [SHOWS_KEY]: rawShows,
    [EDIT_KEY]: rawEdit,
    [BUTTONS_KEY]: rawButtons,
  } = record;
  const rest = Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
  const kind = readKind(rawKind, record, pointer, reporter);
  const actionRefs = readActions(rawAction, record, pointer, reporter);
  const readRef = readReads(rawReads, record, pointer, reporter);
  const showRefs = readShows(rawShows, record, pointer, reporter);
  const editRef = readEdit(rawEdit, record, pointer, reporter);
  const buttonRefs = readButtons(rawButtons, record, pointer, reporter);
  const platformOpRef = readPlatformOp(record, pointer, reporter);
  const platformOpRefs = readPlatformOpList(OPS_KEY, record, pointer, reporter);
  const rowActionRefs = readPlatformOpList(ROW_ACTIONS_KEY, record, pointer, reporter);
  checkPairing(record, kind, pointer, reporter);
  return {
    ...(kind === undefined ? {} : { kind }),
    ...(actionRefs === undefined ? {} : { actionRefs }),
    ...(readRef === undefined ? {} : { readRef }),
    ...(showRefs === undefined ? {} : { showRefs }),
    ...(editRef === undefined ? {} : { editRef }),
    ...(buttonRefs === undefined ? {} : { buttonRefs }),
    ...(platformOpRef === undefined ? {} : { platformOpRef }),
    ...(platformOpRefs === undefined ? {} : { platformOpRefs }),
    ...(rowActionRefs === undefined ? {} : { rowActionRefs }),
    rest,
  };
}

/** 属性が `kind` と組になっているか(`kind` 無しの属性・必須の欠け・その `kind` に書けない属性・併せて書けない属性)を見る。 */
function checkPairing(
  record: Readonly<Record<string, unknown>>,
  kind: ComponentKind | undefined,
  pointer: string,
  reporter: SpecReporter,
): void {
  if (!(KIND_KEY in record)) {
    for (const key of ATTRIBUTE_KEYS.filter((candidate) => candidate in record)) {
      reporter.error(
        `${pointer}.${key}`,
        `${pointer} に ${key} がありますが kind がありません`,
        `${key} は kind と組で書く(kind: form は action、kind: table / detail は reads、kind: actions は reads と actions、kind: platform_read は op、kind: platform_actions は ops)。生成物にしない部品には ${key} も書かない`,
      );
    }
    return;
  }
  if (kind === undefined) return;
  const rule = ATTRIBUTES[kind];
  for (const required of rule.required.filter((key) => !(key in record))) {
    reporter.error(
      `${pointer}.${KIND_KEY}`,
      `${pointer} に kind: ${kind} がありますが ${required} がありません`,
      SUGGESTIONS[required] ?? '',
    );
  }
  for (const key of ATTRIBUTE_KEYS.filter((candidate) => candidate in record)) {
    if (rule.allowed.includes(key)) continue;
    reporter.error(
      `${pointer}.${key}`,
      `${pointer} の kind: ${kind} に ${key} は書けません`,
      `kind: ${kind} が取る属性は ${rule.allowed.join(' / ')} である(${key} は別の kind の属性)`,
    );
  }
  // 編集する表の列は編集してよい欄(`writes`)で決まる。`shows` と併せると、どちらが列を決めるのかが読めない。
  if (EDIT_KEY in record && SHOWS_KEY in record) {
    reporter.error(
      `${pointer}.${SHOWS_KEY}`,
      `${pointer} の edit と shows は併せて書けません`,
      'edit を書いた表の列は編集してよい欄(writes)で決まる。読むだけの列を並べたいなら、edit を書かない表を別に置く',
    );
  }
}

/** `kind` の値を読む(値域の外・文字列でないものは S0)。 */
function readKind(
  raw: unknown,
  record: Readonly<Record<string, unknown>>,
  pointer: string,
  reporter: SpecReporter,
): ComponentKind | undefined {
  if (!(KIND_KEY in record)) return undefined;
  if (typeof raw !== 'string' || !isComponentKind(raw)) {
    reporter.error(`${pointer}.${KIND_KEY}`, `${pointer}.${KIND_KEY} が部品の種類の語彙ではありません`, KIND_SUGGESTION, {
      value: String(raw),
      allowed: COMPONENT_KINDS.join(', '),
    });
    return undefined;
  }
  return raw;
}

/** `action` の値を読む(文字列 1 つか文字列の一覧。**個数は数えない** — 1 部品 1 操作は S17)。 */
function readActions(
  raw: unknown,
  record: Readonly<Record<string, unknown>>,
  pointer: string,
  reporter: SpecReporter,
): readonly ScreenRef[] | undefined {
  if (!(ACTION_KEY in record)) return undefined;
  const at = `${pointer}.${ACTION_KEY}`;
  const list = typeof raw === 'string' ? [raw] : asArray(raw);
  const ids = list === null ? null : list.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  if (list === null || ids === null || ids.length !== list.length || ids.length === 0) {
    reporter.error(at, `${at} が操作 ID として読めません`, ACTION_SUGGESTION, { value: String(raw) });
    return undefined;
  }
  return ids.map((id, index) => ({
    id,
    location: reporter.location(typeof raw === 'string' ? at : `${at}[${index}]`),
  }));
}

/** `reads` の値を読む(文字列 1 つ。一覧は書けない — 1 部品 1 本)。 */
function readReads(
  raw: unknown,
  record: Readonly<Record<string, unknown>>,
  pointer: string,
  reporter: SpecReporter,
): ScreenRef | undefined {
  if (!(READS_KEY in record)) return undefined;
  const at = `${pointer}.${READS_KEY}`;
  if (typeof raw !== 'string' || raw.trim() === '') {
    reporter.error(at, `${at} が読みの ID として読めません`, READS_SUGGESTION, { value: String(raw) });
    return undefined;
  }
  return { id: raw, location: reporter.location(at) };
}

/** `shows` の値を読む(文字列 1 つか文字列の一覧。空の一覧・文字列でない要素は S0)。 */
function readShows(
  raw: unknown,
  record: Readonly<Record<string, unknown>>,
  pointer: string,
  reporter: SpecReporter,
): readonly ScreenRef[] | undefined {
  if (!(SHOWS_KEY in record)) return undefined;
  const at = `${pointer}.${SHOWS_KEY}`;
  const list = typeof raw === 'string' ? [raw] : asArray(raw);
  const names = list === null ? null : list.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  if (list === null || names === null || names.length !== list.length || names.length === 0) {
    reporter.error(at, `${at} が欄の一覧として読めません`, SHOWS_SUGGESTION, { value: String(raw) });
    return undefined;
  }
  return names.map((id, index) => ({
    id,
    location: reporter.location(typeof raw === 'string' ? at : `${at}[${index}]`),
  }));
}
