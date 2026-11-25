/**
 * auth_spec の `axes`(決定表の軸)のパーサー。
 *
 * `parse-auth.ts` が呼ぶ下位のパーサーである。
 * ここで見るのは 1 ファイルの中で閉じる形だけである — **軸の名前は体系側が 1 つも知らない**。
 * 要求するのは次の 4 つだけ。
 *   - **主語の軸**(`kind: state` / `kind: field`)が**ちょうど 1 本**あること(主語は 1 つ)
 *   - その軸の `of` が `subject` と一致すること
 *   - `kind` ごとに要る欄が揃っていること(主語 = `of` / `absent`、enum = `values`)
 *   - `when` / `optional` が排他で、`when.axis` が**自分より前に宣言された別の軸**であること
 *
 * 値が本当にその軸の値かどうか(state の軸なら state_spec の状態であること)は H1 が見る。
 */

import type { SpecReporter } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import type { AuthAxisDecl, AuthAxisKind, AuthAxisPresence } from './types.js';
import { AUTH_AXIS_KINDS, isSubjectKind } from './types.js';
import { IdClaims, readEnum, readSnakeId } from './parse-auth-shared.js';

const AXES_SUGGESTION =
  'axes は "- id / kind / summary / (of・absent | values) / (labels) / (when | optional)" の' +
  'リストで書く(主語の軸(kind: state | field)をちょうど 1 本、その of を subject と同じにする)';

/** `axes` を読む。主語の軸がちょうど 1 本であること(H0)。 */
export function parseAxes(root: YamlReader, subject: string, reporter: SpecReporter): readonly AuthAxisDecl[] {
  const items = root.requiredList('axes', AXES_SUGGESTION) ?? [];
  const axes: AuthAxisDecl[] = [];
  const claims = new IdClaims();
  eachRecord(items, 'axes', reporter, AXES_SUGGESTION, (item, index) => {
    const id = readSnakeId(item, `axes[${index}]`, '軸', reporter);
    if (id === null || !claims.claim(id, `axes[${index}].id`, '軸', reporter)) return;
    const decl = buildAxis(item, id, axes, reporter);
    if (decl !== null) axes.push(decl);
  });
  reporter.settleRows(items.length, axes.length, claims.duplicates);
  checkSubjectAxis(axes, subject, reporter);
  return axes;
}

/**
 * 主語の軸がちょうど 1 本あり、その `of` が `subject` と一致すること。
 *
 * かつてここは「この 2 つの名前の軸があること」を要求しており、**ホストのアプリの 2 語が
 * 必須の軸名として体系側に住んでいた**。体系が要求してよいのは「主語が 1 つに決まること」
 * だけである(軸の名前はこのアプリの事情)。
 */
function checkSubjectAxis(axes: readonly AuthAxisDecl[], subject: string, reporter: SpecReporter): void {
  const subjectAxes = axes.filter(isSubjectKind);
  if (subjectAxes.length === 0) {
    reporter.error(
      'axes',
      'axes に主語の軸(kind: state | field)がありません',
      `axes に { id: {軸名}, kind: state, of: ${subject}, absent: {行が無いことを表す値} } を足す` +
        '(在籍の状態機械を持たないなら kind: field で of に "{エンティティ}.{enum の欄}" を書く)',
      { subject },
    );
    return;
  }
  if (subjectAxes.length > 1) {
    reporter.error(
      'axes',
      `axes に主語の軸が ${subjectAxes.length} 本あります(${subjectAxes.map((axis) => axis.id).join(' / ')})`,
      '決定表の主語は 1 つである。ほかの軸は kind: enum にして values を宣言する',
      { axes: subjectAxes.map((axis) => axis.id).join(', ') },
    );
    return;
  }
  const only = subjectAxes[0];
  if (only !== undefined && only.of !== subject) {
    reporter.error(
      `axes.${only.id}.of`,
      `軸 ${only.id} の of(${only.of})が subject(${subject})と一致しません`,
      'of を subject と同じ文字列にする(決定表の主語は 1 つ)',
      { of: only.of ?? '', subject },
    );
  }
}

/** 軸 1 件を読む。 */
function buildAxis(
  item: YamlReader,
  id: string,
  earlier: readonly AuthAxisDecl[],
  reporter: SpecReporter,
): AuthAxisDecl | null {
  const kind = readEnum<AuthAxisKind>(item, 'kind', AUTH_AXIS_KINDS, reporter, true);
  if (kind == null) return null;
  const summary = item.requiredString('summary', 'summary にこの軸が何を表すかを 1 行で書く');
  if (summary === null) return null;
  const base = {
    id,
    kind,
    summary,
    ...parsePresence(item, id, earlier, reporter),
    location: reporter.location(`axes.${id}`),
  };
  if (isSubjectKind(base)) {
    const hint = kind === 'state' ? '状態機械名' : '"{エンティティ}.{enum の欄}"';
    const of = item.requiredString('of', `of に値の出どころ(${hint}。subject と同じ)を書く`);
    const absent = item.requiredString('absent', 'absent に「行が無いこと」を表す値を書く(例: none)');
    if (of === null || absent === null) return null;
    return { ...base, of, absent, ...readLabels(item, [absent], false, reporter) };
  }
  const values = item.requiredStringList('values', '値の候補を "- value" のリストで書く', false);
  if (values === null) return null;
  return { ...base, values, ...readLabels(item, values, true, reporter) };
}

/**
 * `labels`(値 → 表示名)を読む。
 *
 * 表示名は**仕様が持つ**(分岐図とマトリクスに出る日本語)。ここを体系側に置いていた間、
 * 生成器はこのアプリ固有の日本語の文言を表として持っていた(W1 の出力側の目で実測)。
 * `values` に無い値の表示名は落とす —— 綴り間違いの表示名は「宣言はあるのに誰も引かない」
 * という最も気づきにくい形になるため。`kind: state` の軸は状態そのものを体系が知らないので、
 * 突合は H1(state_spec と照らす)に任せてここは素通しする。
 */
function readLabels(
  item: YamlReader,
  known: readonly string[],
  closed: boolean,
  reporter: SpecReporter,
): { readonly labels?: Readonly<Record<string, string>> } {
  const suggestion = 'labels は "{値}: {表示名}" の写像で書く(分岐図とマトリクスに出る日本語)';
  if (!item.has('labels')) return {};
  const labels = item.optionalStringMap('labels', suggestion);
  // state の軸は absent 以外の値(状態 ID)を体系側が知らないので、突合は H1 に任せる。
  const unknown = Object.keys(labels).filter((value) => !known.includes(value));
  if (closed && unknown.length > 0) {
    reporter.error(
      item.pointer('labels'),
      `labels に values に無い値があります(${unknown.join(' / ')})`,
      `labels の鍵は values(${known.join(' / ')})のいずれかにする`,
      { unknown: unknown.join(', ') },
    );
  }
  return { labels };
}

/**
 * 宣言が読めなかった軸の「行ごとの有無」。
 *
 * **軸そのものは落とさない。** 落とすと決定表の行が「書けない鍵を書いている」ことになり、
 * 1 件の誤りが行の数だけの無関係な指摘(と「同じ条件の行が 2 つ」の誤検出)に膨らむ ——
 * H 群は「カスケードで無関係な指摘を積み増さない」を自分で方針にしている。どの行が持つかが
 * 読めない以上、行の側の必須 / 禁止は**判定しない**(= 任意扱い)のが最小の振る舞いである。
 */
const UNREADABLE_PRESENCE = { optional: true } as const;

/** `when` / `optional`(その軸を持つ行の条件)を読む。両方は書けない。 */
function parsePresence(
  item: YamlReader,
  id: string,
  earlier: readonly AuthAxisDecl[],
  reporter: SpecReporter,
): { readonly when?: AuthAxisPresence; readonly optional?: boolean } {
  const optional = item.optionalBoolean('optional', 'optional は true / false で書く(行ごとに任意の軸か)');
  const whenSuggestion = 'when は "{相手の軸 ID}: {値}" を 1 件だけ書く';
  if (!item.has('when')) return optional === true ? { optional: true } : {};
  const raw = item.optionalStringMap('when', whenSuggestion);
  if (optional === true) {
    reporter.error(
      item.pointer('when'),
      `軸 ${id} が when と optional の両方を宣言しています`,
      'どちらか一方にする(when = その条件の行だけが必ず持つ / optional = 行ごとに任意)',
      { axis: id },
    );
    return UNREADABLE_PRESENCE;
  }
  const entries = Object.entries(raw);
  const first = entries[0];
  if (entries.length !== 1 || first === undefined) {
    reporter.error(
      item.pointer('when'),
      `軸 ${id} の when は 1 件でなければなりません(${entries.length} 件)`,
      whenSuggestion + '(2 つの条件で決まる軸は分ける)',
      { axis: id, count: String(entries.length) },
    );
    return UNREADABLE_PRESENCE;
  }
  const [axis, value] = first;
  if (!earlier.some((candidate) => candidate.id === axis)) {
    reporter.error(
      item.pointer(`when.${axis}`),
      `軸 ${id} の when が指す軸 ${axis} が、この軸より前に宣言されていません`,
      '条件にする軸を先に宣言する(前方参照だけを許すことで、軸どうしの条件が循環しない)',
      { axis: id, refers: axis },
    );
    return UNREADABLE_PRESENCE;
  }
  if (typeof value !== 'string' || value === '') {
    reporter.error(item.pointer(`when.${axis}`), `軸 ${id} の when の値が空です`, whenSuggestion, { axis: id });
    return UNREADABLE_PRESENCE;
  }
  return { when: { axis, value } };
}
