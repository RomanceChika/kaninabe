/**
 * 保存点に渡す**入力の値**と、手順ごとの実行の仕方(束 ⑳-5a2)。
 *
 * `eq-save-cases.ts` が選んだ組み合わせに渡す入力を組む側である。
 *
 * 値は `rls-world-values.ts` の写像(型 → 値)をそのまま使う。**`placeholderOf` ではない** ——
 * 保存点は行を実際に作るので、宣言から読める制約(行内比較の順序・「その欄が真なら別の欄は
 * こう」の含意・数値の範囲・一意)を満たす値でなければ DB に入らない。同じ問いは world の行を
 * 置くときに既に解いてあるので、写像は 1 つである。
 *
 * 繰り返しの手順の要素は**連番を別に取る** —— 同じ値の要素を 2 つ送ると、一意の宣言
 * (「同じ枠に同じ並び順の演目は 1 つ」)に当たって「規則で拒否された」と区別が付かない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { FieldDef, SpecModel } from '../model/types.js';
import type { DataTableSpec } from '../model/data/types.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import type { BuiltSave } from '../usecase/plan-build.js';
import type { ScenarioValue } from '../usecase/plan-scenario-values.js';
import type { EqEnforcement } from './eq-cases.js';
import { enforcementOf } from './eq-catalog.js';
import { frameworkTriggerDecls } from './framework-triggers.js';
import { fieldOrder, valueOfField } from './rls-world-values.js';
import { editedValueOf } from './eq-save-edits.js';

/** 繰り返しの手順に渡す要素の最大数(軸は 0 / 1 / 2 の 3 値)。 */
export const MAX_ELEMENTS = 2;

/**
 * 入力の値の連番の起点。
 *
 * world の行が使う連番(1 から数えたもの)と重ならないところから数える —— 重なると、一意を
 * 宣言した欄で「world に既にある行」と衝突して、規則の判定とは別の理由で落ちる。
 */
const INPUT_SEQ_BASE = 1_000;

/**
 * 押し直しで変える値の連番の起点(入力の値の連番と別に数える —— 入力の値を 1 つも動かさないため)。
 */
const EDIT_SEQ_BASE = 5_000;

/** 対象そのものの識別子の入力の鍵(その集約の行を指す)。 */
const TARGET_ID_KEY = 'id';

/** トリガの発火宣言に出る「削除」の語(追記専用の表を見分ける)。 */
const DELETE_KEYWORD = 'delete';

/** 手順 1 つに渡す入力の 1 組。 */
export interface EqSaveInput {
  /** そのまま載せる欄。 */
  readonly values: Readonly<Record<string, ScenarioValue>>;
  /** 参照の欄 → world のどの集約の行を指すか。 */
  readonly refs: Readonly<Record<string, string>>;
  /**
   * 同じ鍵の押し直しで**1 欄だけ変える**ときの、その欄の別の値(欄 → 値。宣言順)。
   *
   * 値は宣言の範囲の中にある(enum は別の要素・数は範囲の中の別の値・文字列は長さと書式の中の別の連番)——
   * 範囲の外へ変えると、押し直しの比べより先に欄の CHECK で落ち、確かめたい拒否(`resend_input_mismatch`)に届かない
   * (点検 21 回目の後の samples:db の赤。rooms の enum)。真偽・日時・参照は載せない(含意や順序の宣言に当たりうる)。
   */
  readonly edits: Readonly<Record<string, ScenarioValue>>;
}

/** 保存点の手順 1 つぶんの実行の仕方。 */
export interface EqSaveStep {
  readonly op: string;
  /** 入力・結果の鍵(`p_input` の鍵)。 */
  readonly alias: string;
  readonly label: string;
  readonly kind: 'create' | 'transition' | 'delete' | 'update';
  readonly aggregate: string;
  readonly table: string;
  readonly repeat: boolean;
  /** その手順の定型 RPC が拒否をどこまで返すか(data_table の宣言から決まる)。 */
  readonly enforcement: EqEnforcement;
  /** 繰り返さない手順の入力(繰り返す手順では使わない)。 */
  readonly input: EqSaveInput;
  /** 繰り返す手順に渡す要素(先頭から件数の軸のぶんだけ使う)。 */
  readonly elements: readonly EqSaveInput[];
  /** 落としてよい任意の欄(入力の軸が `minimal` のとき送らない)。 */
  readonly optional: readonly string[];
  /**
   * その手順の RPC が**帰属表のほかに書き込む表**(data_table の `also_writes` そのまま)。
   *
   * 実行する間に片付ける相手である —— 副作用の台帳(outbox・監査ログ)に一意の宣言があると、
   * 2 回目の許可が 23505 で落ち、それが「許可 + 制約違反 = 一致」に**飲まれる**
   * (独立レビュー ⑳-5a2 の直す 4)。
   */
  readonly alsoWrites: readonly string[];
}

/** 実行する間に片付ける表(と、宣言が片付けを拒む表)。 */
export interface EqSaveCleanup {
  /**
   * 1 つ実行するたびに「設計図の行以外」を消す表(消す順)。
   *
   * 副作用の台帳 → 作る集約の表の逆順、である。台帳(`also_writes` だけに出る表)が先なのは、
   * それが作られた行に**ぶら下がる**側だからである(親を先に消すと参照が残る)。
   */
  readonly tables: readonly string[];
  /**
   * `also_writes` に出るが片付けない表と、その理由になる宣言。
   *
   * **追記専用を宣言した表**(削除で起こすトリガを持つ表)は消せない。黙って飛ばすのではなく
   * 設計図が示す —— ここに一意の宣言が足された日には、2 回目の許可が飲まれる形に戻る。
   */
  readonly appendOnly: readonly string[];
}

/** 手順の実行の仕方を組み立てるのに要る入力。 */
export interface EqSaveStepsInput {
  readonly domain: SpecModel;
  readonly tables: readonly DataTableSpec[];
  readonly built: BuiltSave;
}

/**
 * 保存点の全手順の実行の仕方を組み立てる。
 *
 * @param input ドメイン仕様・全 data_table・組み立て済みの保存点
 * @returns 手順の並び(宣言順)
 */
export function saveStepsOf(input: EqSaveStepsInput): readonly EqSaveStep[] {
  let seq = INPUT_SEQ_BASE;
  const next = (): number => {
    seq += 1;
    return seq;
  };
  let editSeq = EDIT_SEQ_BASE;
  const nextEdit = (): number => {
    editSeq += 1;
    return editSeq;
  };
  return input.built.plan.steps.map((step, index) => {
    const keys = input.built.facts.steps[index]?.inputKeys ?? [];
    const fields = fieldsOf(input.domain, step.entity, keys);
    const order = fieldOrder(input.domain, step.entity) ?? new Map<string, number>();
    const at = { rowIndex: index, next, nextEdit, order };
    return {
      op: step.op,
      alias: step.alias,
      label: step.label,
      kind: step.kind,
      aggregate: step.entity,
      table: step.table,
      repeat: step.repeat,
      enforcement: enforcementOf(input.tables, step.fn.name),
      input: inputOf(input.domain, step.entity, keys, fields, at),
      elements: step.repeat
        ? Array.from({ length: MAX_ELEMENTS }, (_, element) =>
            inputOf(input.domain, step.entity, keys, fields, { ...at, rowIndex: index + element + 1 }),
          )
        : [],
      optional: fields.filter((field) => !field.required).map((field) => field.name),
      alsoWrites: alsoWritesOf(input.tables, step.fn.name),
    };
  });
}

/** その RPC が帰属表のほかに書き込む表(宣言が無ければ空)。 */
function alsoWritesOf(tables: readonly DataTableSpec[], rpc: string): readonly string[] {
  for (const table of tables) {
    const found = table.functions.find((candidate) => candidate.name === rpc);
    if (found !== undefined) return found.alsoWrites;
  }
  return [];
}

/**
 * 実行する間に片付ける表を、手順の宣言から決める。
 *
 * 作る集約の表だけでは足りない —— 手順の RPC は `also_writes` に宣言した表にも書くので、
 * そこに一意の宣言があると**2 回目の許可**が 23505 になり、「許可 + 制約違反」として一致に
 * 飲まれる(独立レビュー ⑳-5a2 の直す 4)。したがって片付ける相手は
 * 「作る集約の表 ∪ 全手順の `also_writes`」である。
 *
 * ただし**追記専用を宣言した表は消せない**(削除で起こすトリガがある)。飛ばした表は報告する。
 *
 * @param tables 全 data_table
 * @param steps その保存点の手順の並び
 * @returns 片付ける表(消す順)と、片付けない表
 */
export function saveCleanupOf(
  tables: readonly DataTableSpec[],
  steps: readonly EqSaveStep[],
): EqSaveCleanup {
  const created: string[] = [];
  for (const step of steps) {
    if (step.kind === 'create' && !created.includes(step.table)) created.push(step.table);
  }
  const ledgers: string[] = [];
  const appendOnly: string[] = [];
  for (const table of steps.flatMap((step) => step.alsoWrites)) {
    if (created.includes(table) || ledgers.includes(table) || appendOnly.includes(table)) continue;
    if (appendOnlyTable(tables, table)) appendOnly.push(table);
    else ledgers.push(table);
  }
  return { tables: [...ledgers, ...[...created].reverse()], appendOnly };
}

/**
 * 追記専用を宣言した表か(削除で起こすトリガを持つか)。
 *
 * 判定は宣言そのものである —— `fires` の散文に `delete` が出る行トリガは「消させない」と
 * 言っており、その表から行を消そうとすれば執行点が実行する。**設計図が持つ執行点も同じ宣言**で
 * ある(仕組みが自分で持つ表の追記専用トリガ。宣言の正は `framework-triggers.ts`。トリガ関数の本体が
 * SQL の側に在っても「消せない表」であることは変わらない)。
 */
function appendOnlyTable(tables: readonly DataTableSpec[], table: string): boolean {
  const spec = tables.find((candidate) => candidate.table === table);
  if (spec === undefined) return false;
  return [...spec.triggers, ...frameworkTriggerDecls(spec)].some((trigger) =>
    (trigger.fires ?? '').includes(DELETE_KEYWORD),
  );
}

/**
 * その手順が受け取る欄の宣言(値を組む欄だけ)。
 *
 * **参照の欄と対象の識別子(`id`)は除く。** そこに入るのは world の行の id であり、型から決めた
 * 値を入れると参照が届かない —— 落としてよい任意の欄の並びも同じ理由でここから導く
 * (`id` を「任意だから落とす」と読むと、動かす手順が的を失う)。
 */
function fieldsOf(domain: SpecModel, entity: string, keys: readonly string[]): readonly FieldDef[] {
  const spec = findEntitySpec(domain, entity);
  if (spec === null) return [];
  return keys.flatMap((key) => {
    if (key === TARGET_ID_KEY) return [];
    const field = spec.fields.find((candidate) => candidate.name === key);
    if (field === undefined || field.type.kind === 'ref') return [];
    return [field];
  });
}

/** 値を組む文脈(行の番号・連番・押し直しの値の連番・順位)。 */
interface InputAt {
  readonly rowIndex: number;
  readonly next: () => number;
  readonly nextEdit: () => number;
  readonly order: ReadonlyMap<string, number>;
}

/** 入力 1 組(参照の欄は world の集約を指し、それ以外は型から決めた値)。 */
function inputOf(
  domain: SpecModel,
  entity: string,
  keys: readonly string[],
  fields: readonly FieldDef[],
  at: InputAt,
): EqSaveInput {
  const values: Record<string, ScenarioValue> = {};
  const refs: Record<string, string> = {};
  const spec = findEntitySpec(domain, entity);
  for (const key of keys) {
    if (key === TARGET_ID_KEY) {
      refs[key] = entity;
      continue;
    }
    const field = spec?.fields.find((candidate) => candidate.name === key);
    if (field === undefined) continue;
    if (field.type.kind === 'ref') refs[key] = field.type.entity;
  }
  for (const field of fields) values[field.name] = valueOfField(field, at);
  const edits: Record<string, ScenarioValue> = {};
  for (const field of fields) {
    const edit = editedValueOf(field, values[field.name], at);
    if (edit !== null) edits[field.name] = edit;
  }
  return { values, refs, edits };
}
