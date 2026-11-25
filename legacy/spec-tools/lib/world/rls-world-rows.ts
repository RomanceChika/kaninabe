/**
 * RLS の挙動テストが置く**行の並び**(world の 1 系統)を組み立てる純関数(束 ⑳-4b)。
 *
 * 1 系統 = 実行者 1 人ぶんである。その実行者の集約の行から始めて、対象の表の行に要る参照を
 * 1 段ずつ遡り、**集約ごとに 1 行だけ**作る。同じ集約を共有するのは字数の節約ではなく、
 * 宣言を満たすための要件である —— 「この演目の催しは、その枠の催しと同じでなければならない」
 * (`formal.type: check` の `{a}.workshop_id == {b}.workshop_id`)のような行内比較は、参照を
 * 別々に作ると必ず落ちる。
 *
 * **例外は束縛が名指しする列である。** 同じ相手を指す参照が 2 本あり(たとえば申請の行が
 * 申請者と承認者の欄をどちらも同じ従業員の `ref(…)` で持つ形)、その 2 本にそれぞれ
 * 別のロールが束縛されているとき、1 行に畳むと**どちらの束縛も必ず同時に立つ** —— 述語の列を
 * 隣の列に取り違えても検査が緑のままになる。そこで束縛が名指しする列は、その系統の実行者の
 * 束縛でない限り**別の行**(= 別人)を指す。分けるのは束縛の列だけであり、それ以外の参照は
 * 畳んだままである(行内比較の不変条件を落とさないため)。
 *
 * 参照が循環していても止まる —— 先に行の名前を登録してから欄を辿るので、戻ってきた参照は
 * 既にある行を指す。並び順は**参照先が先**になり、循環の辺だけが後ろ向きに残る(その 1 本は
 * 遅延可能な外部キーであることが前提で、実行する側が 1 トランザクションに包んで検査を遅らせる)。
 *
 * **もう 1 つの例外は、参照の列が一意の鍵になっているときである**(`formal.type: uniqueness` の鍵がその 1 列だけで、
 * `where` が無い。たとえば「1 つの招待から生まれるメンバーは 1 人まで」= メンバーの `invited_via`)。同じ集約の行が
 * 1 系統に 2 つ以上あると(実行者自身の行と、的として分けた別人の行)、1 行に畳んだ参照先を両方が指して
 * 一意制約に当たり、world が 1 行も入らない。そこで一意の参照の列は、**参照する行ごとに別の行**を指す。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import type { RlsValue } from './rls-world-values.js';
import { emptyFieldsOf } from './rls-world-empty.js';
import { uniqueRefColumnsOf } from './rls-world-unique.js';
import { fieldOrder, isValueSupplied, valueOfField } from './rls-world-values.js';

/** world の行 1 つ(生成物にそのまま出る形)。 */
export interface RlsWorldRow {
  /** world の中でこの行を指す名前。 */
  readonly key: string;
  readonly table: string;
  readonly entity: string;
  /** そのまま入れる列。 */
  readonly values: Readonly<Record<string, RlsValue>>;
  /** 列 → 参照する行の名前。 */
  readonly refs: Readonly<Record<string, string>>;
  /** この行が実行者自身の行なら、その実行者の名前。 */
  readonly actor: string | null;
  /** 集約 → その行の名前(自分を含み、参照を遡って届く全部)。 */
  readonly ancestry: Readonly<Record<string, string>>;
}

/** 1 系統を組み立てるのに要る入力。 */
export interface BranchInput {
  readonly domain: SpecModel;
  /** 集約 → 物理テーブル名(無ければ届かない参照)。 */
  readonly tableOf: (entity: string) => string | null;
  /** 集約 → data_table が宣言した列の既定値。 */
  readonly defaultsOf: (entity: string) => Readonly<Record<string, string>>;
  /** 実行者の集約(`session: true` を宣言した 1 つ)。 */
  readonly actorEntity: string;
  /** 任意の欄でも値が要るもの(集約 → 欄名。束縛の列・境界の列)。 */
  readonly requiredFields: (entity: string) => readonly string[];
  /** 束縛が名指しする列(集約 → 列名)。その列の参照先は他と共有しない。 */
  readonly boundColumns: (entity: string) => readonly string[];
  /** この系統の実行者の役が束縛する場所(その列だけは実行者自身の行へ届く)。 */
  readonly ownBinding: { readonly entity: string; readonly column: string } | null;
  /** world 全体で一意な連番。 */
  readonly next: () => number;
}

/** 組み立てた 1 系統。 */
export interface Branch {
  /** 挿入順の行。 */
  readonly rows: readonly RlsWorldRow[];
  /** 集約 → その系統の行の名前。 */
  readonly byEntity: ReadonlyMap<string, string>;
  /** 検査の的になる行の名前(`separateTarget` のときだけ `byEntity` と違う)。 */
  readonly targetKey: string | null;
  /**
   * 的が**複数**あるときの、集約 → 的の行の名前。
   *
   * 的が 1 つの world(RLS・単発の操作)では `targetKey` の 1 件だけが入る。保存点は複数の集約を
   * 1 つの系統に置く —— 読む集約と、作る行が参照する集約が別々にあるからである。どちらも
   * 同じ 1 本の系統に置くのは、集約をまたぐ行内比較(「この枠の催しは、その演目の催しと同じ」)
   * を満たすためであり、系統を分けると必ず落ちる(このファイルの冒頭の理由と同じ)。
   */
  readonly targetKeys: ReadonlyMap<string, string>;
}

/** 系統の組み立て方の選択。 */
export interface BranchOptions {
  /**
   * 対象の集約が**実行者の集約そのもの**のとき、的を別の行にするか。
   *
   * 既定は false(1 行を共有する)。true にすると「自分ではない誰かの行を動かす」形になる ——
   * 操作を実行する world ではこれが要る。同じ行を的にすると、実行者自身の行の欄を根拠にする役
   * (`claim`)の含意(「その欄が真ならこの欄はこう」)と、的の状態を振る軸が正面から
   * ぶつかり、置ける状態が 1 つに潰れるからである。**その役の束縛が的の `id` 自身を指す
   * とき**(本人ロール)は呼び側が false を渡す —— 分けたら根拠が消える。
   */
  readonly separateTarget?: boolean;
}

/** 組み立ての結果(届かない参照があれば集約名を示して失敗する)。 */
export type BranchResult =
  | { readonly ok: true; readonly branch: Branch }
  | { readonly ok: false; readonly unreachable: readonly string[] };

/**
 * 実行者 1 人ぶんの系統を組み立てる。
 *
 * @param input ドメイン仕様と表の対応
 * @param actor その系統の実行者の名前
 * @param target 対象の集約(この集約の行が検査の的になる)。**配列を渡すと的が複数になる**
 *   —— 保存点は読む集約と作る行の参照先を同じ 1 本の系統に置く。並びは宣言順で、
 *   `targetKey` には先頭の的が入る(的が 1 つの呼び方は文字列のままで、出力も変わらない)
 * @returns 挿入順の行と集約の対応、または届かなかった参照
 */
export function buildBranch(
  input: BranchInput,
  actor: string,
  target: string | readonly string[],
  options: BranchOptions = {},
): BranchResult {
  const state: BuildState = { rows: [], byEntity: new Map(), bySlot: new Map(), unreachable: [] };
  ensureRow(input, state, actor, input.actorEntity);
  const targets = typeof target === 'string' ? [target] : target;
  const targetKeys = new Map<string, string>();
  let targetKey: string | null = null;
  for (const [index, entity] of targets.entries()) {
    const separate = options.separateTarget === true && entity === input.actorEntity;
    const key = ensureRow(input, state, actor, entity, separate ? `${entity}#target` : undefined);
    if (index === 0) targetKey = key;
    if (key !== null) targetKeys.set(entity, key);
  }
  if (state.unreachable.length > 0) return { ok: false, unreachable: [...new Set(state.unreachable)] };
  const rows = state.rows.map((row) => ({ ...row, ancestry: ancestryOf(row, state) }));
  return { ok: true, branch: { rows, byEntity: state.byEntity, targetKey, targetKeys } };
}

/** 組み立て中の状態(行の並び・集約の対応・届かなかった参照)。 */
interface BuildState {
  readonly rows: DraftRow[];
  readonly byEntity: Map<string, string>;
  /** 束縛の列のために分けた行(`{集約}.{列}` → 行の名前)。 */
  readonly bySlot: Map<string, string>;
  readonly unreachable: string[];
}

/** 祖先を解く前の行。 */
type DraftRow = Omit<RlsWorldRow, 'ancestry'>;

/**
 * その集約の行を(まだ無ければ)作る。
 *
 * 名前を先に登録するので、参照が循環していても戻ってきた側は既にある行を指す。
 *
 * @param slot 束縛の列のために分ける行なら `{集約}.{列}`(共有する行なら `undefined`)
 * @returns その行の名前。届かない参照なら `null`
 */
function ensureRow(
  input: BranchInput,
  state: BuildState,
  actor: string,
  entity: string,
  slot?: string,
): string | null {
  const existing = slot === undefined ? state.byEntity.get(entity) : state.bySlot.get(slot);
  if (existing !== undefined) return existing;
  const table = input.tableOf(entity);
  const spec = findEntitySpec(input.domain, entity);
  const order = fieldOrder(input.domain, entity);
  if (table === null || spec === null || order === null) {
    state.unreachable.push(entity);
    return null;
  }
  const key = slot === undefined ? `${actor}:${entity}` : `${actor}:${entity}#${slot}`;
  if (slot === undefined) state.byEntity.set(entity, key);
  else state.bySlot.set(slot, key);
  // 日時の刻みは**world 全体で**ずらす(系統ごとに 1 から数え直すと、別の系統の同じ集約の
  // 行が同じ日時になる —— 日時を含む一意の宣言があったときにそこで当たる)。
  const rowIndex = input.next();

  const values: Record<string, RlsValue> = {};
  const refs: Record<string, string> = {};
  const defaults = input.defaultsOf(entity);
  const extra = input.requiredFields(entity);
  // 「空かどうか」を問う不変条件が空を要求する欄には、束縛・境界の都合があっても値を置かない
  // —— 置いた瞬間に執行点が拒否し、行が 1 つも入らなくなる(束 ㉒)。
  const empty = emptyFieldsOf(input.domain, entity);
  for (const field of spec.fields) {
    if (!isValueSupplied(field, defaults) || empty.has(field.name)) continue;
    if (!field.required && !extra.includes(field.name)) continue;
    if (field.type.kind === 'ref') {
      // 一意の鍵の参照は行ごとに別の行を指す(行の名前を含む slot)。束縛の列は集約と列で 1 行を共有する。
      const slotOfRef = uniqueRefColumnsOf(input.domain, entity).has(field.name)
        ? `${key}.${field.name}`
        : isSplitColumn(input, entity, field.name)
          ? `${entity}.${field.name}`
          : undefined;
      const referenced = ensureRow(input, state, actor, field.type.entity, slotOfRef);
      if (referenced !== null) refs[field.name] = referenced;
      continue;
    }
    values[field.name] = valueOfField(field, { rowIndex, next: input.next, order });
  }
  state.rows.push({
    key,
    table,
    entity,
    values,
    refs,
    // 実行者自身の行は系統に 1 つである —— 束縛のために分けた行は、同じ集約でも別人である。
    actor: entity === input.actorEntity && slot === undefined ? actor : null,
  });
  return key;
}

/**
 * その列の参照先を他と共有しないか(束縛が名指しする列で、この系統の実行者の束縛ではない)。
 *
 * 実行者自身の束縛の列は共有する —— そこが実行者の行を指さなければ、そのロールで立つ行が
 * world に 1 つも無いことになる。
 */
function isSplitColumn(input: BranchInput, entity: string, column: string): boolean {
  if (!input.boundColumns(entity).includes(column)) return false;
  const own = input.ownBinding;
  return own === null || own.entity !== entity || own.column !== column;
}

/**
 * その行から参照を遡って届く集約の対応(自分を含む)。
 *
 * オラクルは「このロールの束縛が**載っている**集約の行」をここから引く —— 束縛が指す集約へ
 * どう届くかを SQL の翻訳器とは独立に(参照の道を辿り直さずに)決められるようにするためである。
 * 束縛の列のために分けた行があると、同じ集約の行が 2 つ届きうる。そのとき近い方(幅優先で
 * 先に見つかる方)を採るが、**束縛が載っている集約の行は分けない**(分けるのは参照先の側で
 * ある)ので、オラクルが引く 1 行は一意である。
 */
function ancestryOf(row: DraftRow, state: BuildState): Readonly<Record<string, string>> {
  const found: Record<string, string> = { [row.entity]: row.key };
  const queue = [row];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    for (const key of Object.values(current.refs)) {
      const next = state.rows.find((candidate) => candidate.key === key);
      if (next === undefined || found[next.entity] !== undefined) continue;
      found[next.entity] = next.key;
      queue.push(next);
    }
  }
  return found;
}

/** その行の列の値を差し替える(`claim` のロールの根拠になる欄を真にするため)。 */
export function withValues(row: RlsWorldRow, values: Readonly<Record<string, RlsValue>>): RlsWorldRow {
  return { ...row, values: { ...row.values, ...values } };
}

/**
 * 境界(`filters`)の列に、その系統の**実行者の行の値**を写す。
 *
 * 「実行者の属性と一致する行」を world に置くには、その列の値が実行者の側と同じでなければならない
 * (参照の列なら同じ行を指していなければならない)。系統が違えば実行者も違うので、これだけで
 * 「他のテナントの行」が world に現れる。
 *
 * @param row 境界の列を持つ行
 * @param actorRow その系統の実行者自身の行
 * @param fields 列 → 実行者の欄
 * @returns 値を写した行
 */
export function withBoundary(
  row: RlsWorldRow,
  actorRow: RlsWorldRow | undefined,
  fields: Readonly<Record<string, string>>,
): RlsWorldRow {
  if (actorRow === undefined) return row;
  const values: Record<string, RlsValue> = { ...row.values };
  const refs: Record<string, string> = { ...row.refs };
  for (const [column, field] of Object.entries(fields)) {
    const value = actorRow.values[field];
    const ref = actorRow.refs[field];
    if (value !== undefined) values[column] = value;
    if (ref !== undefined) refs[column] = ref;
  }
  return { ...row, values, refs };
}
