/**
 * 定型 RPC の本文が**どの列に何を書くか**の引き当て。`rpc-facts.ts` が集める「本文に要る事実」の
 * うち、作成と編集の列を持つ。
 *
 * ここが読む宣言は 4 つ: entity_spec の `fields`(行の形 = 作成が入れうる列の母集合)/
 * action_spec の `input`(作成が受け取る**任意の**欄)/ access_spec の `writes`
 * (書き換えてよい列と効果の門)/ data_table の `defaults`(既定値を持つ列)。
 * **遷移が自分の列に何を書くか**(state_spec の `clears` / `records_time`)は読む宣言の集合が別なので
 * `rpc-transition-columns.ts` が持つ(作成と編集の列は entity・action・access・data_table の 4 つから
 * 決まり、遷移の列は state_spec の語から決まる)。
 */

import type { FieldDef } from '../model/types.js';
import { isInputAbsent } from '../model/types.js';
import { insertAtColumnsOf } from '../model/data/types.js';
import { findEntityFields } from '../semantics/domain-index.js';
import { findAccessSpec } from '../semantics/domain-lookup.js';
import { declaredOwner } from '../usecase/actor-bound.js';
import { actorEntity } from '../usecase/param-source-facts.js';
import { insertValue } from './rpc-parts.js';
import { columnExpression } from './sql-types.js';
import type { RpcParam } from './rpc-params.js';
import type { InsertColumn, RpcFactsInput, TransitionColumn } from './rpc-facts.js';

/**
 * 1 欄ずつ受ける引数が、その列に入るときの式。
 *
 * **jsonb の袋の経路と同じ 1 本**(`sql-types.ts` の `columnExpression`)を通す ——
 * 経路ごとに cast の規則を持つと片方にだけ抜ける(その実測が予約を作る個別引数の RPC で、
 * `text` の引数を `timestamptz` の列へ素で入れる SQL が生成されていた)。宣言した引数型が
 * 列の型と一致していれば(T14 が error で見る)ここは引数名をそのまま返す。
 *
 * @param param 引数 1 本(名前と宣言された型)
 * @param field 入れる先の欄
 * @returns SQL の式
 */
function paramValue(param: RpcParam, field: FieldDef): string {
  return columnExpression(param.name, param.type, field.type);
}

/** その集約の予約 ID の action_spec(作成の入力欄を引く)。 */
function reservedAction(input: RpcFactsInput, entity: string): { readonly input: readonly { readonly entity: string; readonly field: string }[] } | null {
  const op = `${entity}.${input.shape}`;
  return input.actions?.actions.find((candidate) => candidate.handles.raw === op) ?? null;
}

/** 作成が入れる列(引数の宣言順。`p_values` はその場で欄に展開する)。 */
export function insertColumns(input: RpcFactsInput, entity: string, params: readonly RpcParam[]): readonly InsertColumn[] {
  if (input.shape !== 'create') return [];
  const actors = actorParams(input, entity, params);
  const columns: InsertColumn[] = [];
  for (const param of params) {
    if (param.role.kind === 'new_id') {
      columns.push({ name: 'id', expression: param.name, fromParam: true, actor: false });
      continue;
    }
    if (param.role.kind === 'column') {
      columns.push({
        name: param.role.field.name,
        expression: paramValue(param, param.role.field),
        fromParam: true,
        actor: actors.has(param.name),
      });
      continue;
    }
    if (param.role.kind !== 'values') continue;
    for (const field of valueFields(input, entity, params)) {
      columns.push({
        name: field.name,
        expression: insertValue(param.name, field, input.table.defaults),
        fromParam: false,
        actor: false,
      });
    }
  }
  return columns;
}

/**
 * 実行者そのものが入る列の引数(`p_actor_id` を除く)。
 *
 * 規約は param-source-fields.ts の裏返しである —— 作成の action_spec が **`owner` で明示した持ち主の欄**だけが
 * 作成者自身で埋まる。監査ログの `actor_id` に既に刻まれているので、payload には二度書かない。再送の作成者の欄
 * (`resend.creator`)の候補もこの列だけである。以前は「実行者の集約を指す参照欄で入力に現れないもの」を全部
 * 作成者と見なし、査閲者の欄まで再送の作成者の候補に挙げていた(点検 9 回目 A9-1)。
 */
function actorParams(input: RpcFactsInput, entity: string, params: readonly RpcParam[]): ReadonlySet<string> {
  const owner = declaredOwner(input.actions, entity);
  const names = new Set<string>();
  if (owner === null || inputFieldNames(input, entity).includes(owner)) return names;
  for (const param of params) {
    if (param.role.kind === 'column' && param.role.field.name === owner) names.add(param.name);
  }
  return names;
}

/** 実行者の集約を指す参照欄で、作成の入力に現れないもの(値の袋 `p_values` から外す欄)。 */
function actorRefsOutsideInput(input: RpcFactsInput, entity: string): ReadonlySet<string> {
  const actor = actorEntity(input.domain);
  const given = new Set(inputFieldNames(input, entity));
  const names = new Set<string>();
  for (const field of findEntityFields(input.domain, entity) ?? []) {
    if (field.type.kind === 'ref' && field.type.entity === actor && !given.has(field.name)) names.add(field.name);
  }
  return names;
}

/** その集約の予約 ID の action_spec が宣言する入力欄(宣言順)。 */
export function inputFieldNames(input: RpcFactsInput, entity: string): readonly string[] {
  const action = reservedAction(input, entity);
  return (action?.input ?? []).filter((ref) => ref.entity === entity).map((ref) => ref.field);
}

/**
 * 作成の `p_values` が運ぶ欄(**母集合は entity_spec の `fields`**。宣言順)。
 *
 * 母集合を action_spec の `input` に取らない —— `p_values` の中身は「呼び手が誰か」ではなく
 * **その集約の行の形**で決まる。予約 ID の action_spec を持たない集約(受信 Webhook や
 * 保存点の中からしか作られないもの)でも本文が退化しないことが、この向きの本質である
 * (取っていた頃は母集合が空になり、`insert into t (id) values (p_id)` が黙って生成された)。
 *
 * 落とすのは 4 つ:
 *   - `id`(冪等キーとして `p_id` が受ける)
 *   - 入力に現れない欄(`auto` / 状態列 / `supplied_by: db`)—— DB が決める値
 *   - ほかの引数が 1 欄ずつ受け取る欄(同じ値の口を 2 つ作らない)
 *   - 入力に無い実行者への参照の欄(`actorRefsOutsideInput`。作成者で埋まる持ち主の欄か、値が決まらない欄 ——
 *     利用者の値の袋で運ばない)
 *
 * 残った欄のうち口を開けるのは 2 種類である ——
 *   - **action_spec の `input` に現れる欄**(人が渡すと宣言された欄。必須でも任意でもよい)
 *   - **必須で、列の既定値の宣言(`defaults`)を持たない欄**(渡されなければ行が成立しない)
 * 逆に、必須でも `defaults` があるなら口を開けない(渡さなくても列の既定値で行が成立する。
 * 開けると「DB が決める」と宣言した値を呼び手が上書きできる)。任意で `input` にも無い欄も
 * 開けない —— それは「後の遷移や編集が決める欄」(確定した金額・紐づくアカウント)であり、
 * 作成時に書ける口を開けると状態機械や許可列の宣言を迂回できてしまう。
 */
export function valueFields(input: RpcFactsInput, entity: string, params: readonly RpcParam[]): readonly FieldDef[] {
  if (input.shape !== 'create') return [];
  const consumed = new Set(params.filter((param) => param.role.kind !== 'values').map((param) => param.name.slice(2)));
  const given = new Set(inputFieldNames(input, entity));
  const byActor = actorRefsOutsideInput(input, entity);
  // `insert_at` の末尾の番号の列は supplied_by: db でも、作成の入力に現れるなら値の袋で運ぶ(空なら DB が末尾に振る。fix25s)。
  const insertAt = insertAtColumnsOf(input.table);
  return (findEntityFields(input.domain, entity) ?? []).filter(
    (field) =>
      field.name !== 'id' &&
      (!isInputAbsent(field) || (insertAt.has(field.name) && given.has(field.name))) &&
      !consumed.has(field.name) &&
      !byActor.has(field.name) &&
      (given.has(field.name) || (field.required && input.table.defaults[field.name] === undefined)),
  );
}

/** 書き換えてよい列と、効果の門になる列(entity_spec の宣言順で安定させる)。 */
export function writeColumns(
  input: RpcFactsInput,
  entity: string,
  fields: readonly FieldDef[],
): { readonly all: readonly FieldDef[]; readonly gated: readonly FieldDef[] } {
  if (input.shape !== 'update') return { all: [], gated: [] };
  const access = findAccessSpec(input.domain, entity);
  const all = new Set((access?.writes ?? []).flatMap((rule) => rule.fields));
  const gated = new Set(
    (access?.writes ?? []).filter((rule) => (rule.effects ?? []).length > 0).flatMap((rule) => rule.fields),
  );
  return {
    all: fields.filter((field) => all.has(field.name)),
    gated: fields.filter((field) => gated.has(field.name)),
  };
}

/**
 * 編集が**変更集合とは別に**書く列(`p_{列}` の引数。束 ㉒)。
 *
 * 値を決めるのは action_spec の `computes` が名指しした純関数であり、人の入力ではない。
 * 空(`null`)は「この呼び出しでは決まらなかった」= **触れない**であり、遷移が
 * `records_actor` を持たない列に空を渡すのと同じ契約である(`coalesce(p_x, t.x)`)。
 *
 * **列ごとのロールの門は付かない。** 門は 1 つの `update` 文全体に掛かっており、
 * 「その実行者がその編集をしてよい」ことが通った行にだけこの代入が起きる —— 遷移 RPC が
 * `p_{列}` を書くときとまったく同じ構えである(遷移の `by` が門で、列ごとの門は無い)。
 *
 * **変更集合の経路は消さない。** 同じ列が `writes` にも並んでいれば、その列は「鍵が送られたら
 * 変更集合の値・送られなければ引数の値」になる(本文の組み立ては `rpc-body-shapes.ts`)。
 * 引数を足したことで `writes` の規則が本文から消えると、その規則を落とす変異を**どの検査も
 * 捕らなくなる**(実測: ハンドブックの変異マトリクスが「検査の漏れ」として報告した)。
 */
export function updateColumns(input: RpcFactsInput, params: readonly RpcParam[]): readonly TransitionColumn[] {
  if (input.shape !== 'update') return [];
  return params.flatMap((param) =>
    param.role.kind === 'column'
      ? [
          {
            name: param.role.field.name,
            expression: `coalesce(${paramValue(param, param.role.field)}, t.${param.role.field.name})`,
          },
        ]
      : [],
  );
}
