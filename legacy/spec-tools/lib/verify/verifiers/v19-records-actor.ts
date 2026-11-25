/**
 * V19 「この遷移が自分の列に何をするか」(`records_actor` / `records_time` / `clears`)の接地。
 *
 * domain-spec-writing.md §state_spec の要求: `records_actor` に並ぶ列は
 *   (a) その集約の entity_spec に**実在する**
 *   (b) **`ref(実行者の集約)`** 型である(書き留めるのは実行者そのものだから)
 *   (c) `access_spec` の **`transition_writes`** に載っている(= 人の操作としては現れず、
 *       遷移が書く列であることの集約単位の宣言。**どの経路も作らない**宣言である)
 *
 * (c) は以前 `writes` の `by: system` の行で近似していた。その行は「内部実行が編集で書ける」という実行の許可でもあり、
 * 編集の RPC に入口の追えない内部実行の書き込みの経路を作っていた(2026-10-20 オーケストレーターの裁定で分けた)。
 * 逆向きに、`transition_writes` に載せたのにどの遷移も書かない列・実在しない列は、腐った宣言として止める。
 *
 * ## なぜこの検査が要るのか
 *
 * 「対応者を書くのは対応開始だけで、再開は書かない」という知識は、束 ⑰-2 より前は
 * **state_spec の散文と TS の operation にしか無かった**(`access_spec` の `writes` は集約単位
 * なのでイベントを区別できない)。`records_actor` はその 1 行を宣言の側に出す欄だが、宣言できる
 * ようにしただけでは「遷移が宣言に無い列を書く」という抜け道が開く —— この検査が (c) でその口を
 * 閉じ、(b) で「実行者以外の値を書き留める」誤用(そちらは action_spec の `computes` が受け皿)を
 * 分ける。
 *
 * ## 3 語の分担
 *
 * 遷移が自分の行に書く値の種類は 6 つで閉じている(実行者 / いま / 空 / 別集約の写し /
 * 純関数の値 / 入力の値。docs/design/triage-transition-writes-2.md §2 の全数表)。そのうち
 * **イベント単位でしか言えない 3 つ**をこの 3 語が受け持つ:
 *
 * | 語 | 書く値 | 型の要求 | RPC の引数 |
 * |---|---|---|---|
 * | `records_actor` | 実行者そのもの | `ref(実行者の集約)` | **要る**(値は呼び出し側から届く) |
 * | `records_time` | いま | `datetime` | **要らない**(SQL の `now()`) |
 * | `clears` | 空 | 空にできる列 | 要らない(生成器が直に `null` を書く) |
 *
 * どの語も**同じ 3 点**を見る —— 実在する / その語が要求する型である / `access_spec` の
 * `transition_writes` に載っている(「人の操作としては現れず、遷移が書く列」である
 * ことの集約単位の宣言)。そのうえで **同じイベントが同じ列を 2 つの語に並べることはできない**
 * (書き留めるのと空にするのは同時に成り立たない)。**別のイベントなら並べてよい** ——
 * 「保管が保管日時を書き、復元が空に戻す」はまさにその形である。`clears` と `records_time` を
 * 見る部分(`checkClears` ・`checkRecordsTime`)も同じファイルにある。以下は `clears` の由来である。
 *
 * ## `clears` —— 「空にする」の宣言(束 ⑰-3)
 *
 * 裏返しの穴が残っていた(独立レビュー 5-A): 宣言に無い列に計画は空を渡すが、その空が
 * **触れない**のか**空にする**のかは RPC の本文だけが知っていた。同じ宣言の不在が正反対の
 * 結果を生む状態である。`clears` はその 1 行を宣言の側に出す欄であり、ここで見るのは
 *   (a) その集約の entity_spec に実在する
 *   (b) **空にできる**列である(判定は `canBeEmpty` の 1 本。V10 の「`is null` を書ける欄か」と
 *       同じ問いなので写像を共有する —— `required` だけでなく `auto: true` / `state(...)` も
 *       「行では必ず値がある」側に落ちる)
 *   (c) `records_actor` と同じく `transition_writes` に載っている
 * の 3 つ。同じ列を両方に並べることはできない(書き留めると空にするは同時に成り立たない)。
 * 宣言が本文どおりか(`coalesce` か代入か)は rpc-parity が実 DB と突き合わせる。
 *
 * ## 値の口(束 ㉔)
 *
 * 上の 3 点は**宣言の整合**しか見ない。「宣言した列を動かす口が遷移 RPC にあるか」は別の
 * 問いであり、無ければ**宣言があるのに本文が何もしない**(空振り)。2 語で答えが違う:
 *
 * | 語 | 書く値 | 口 |
 * |---|---|---|
 * | `clears` | 空 | **要らない** —— 引数が無ければ生成器が直に `null` を書く(`rpc-columns.ts`) |
 * | `records_actor` | 実行者 | **要る** —— 値は呼び出し側から届くので `p_{列}` の引数が要る |
 *
 * そこでここが見るのは `records_actor` の側だけである。data_table が読めない構成では
 * 何も見ない(V17 が `defaults` を見られないときと同じ扱い)。
 *
 * @oversize 超える理由: V19 は「遷移が自分の列に何をするか」という 1 つの問いを 3 語(`records_actor` /
 *   `records_time` / `clears`)について見る検査で、3 語は同じ 3 点(実在・型・`writes` の宣言)と同じ
 *   Finding の組み立てを共有する。語ごとの差(型の要求・値の口の要否)を 1 か所で見比べられる。
 * @split-review 割る案と結果: `clears` / `records_time` の判定(`checkClears` ・`checkRecordsTime`と、3 語が共有する
 *   Finding の組み立て。以前の `v19-transition-writes.ts`)を別のファイルに割る案を検討した(以前はそうなって
 *   いた)。そちらは共有の部品と 2 語の判定だけの葉で、`records_actor` の側の検証器の本体から一方向に読まれる
 *   だけであり、ほかの検証器は使わない(使い手が 1 人)。3 語の分担表は 3 語すべてにまたがる説明なので、
 *   割ると語どうしの差を読み比べるたびに 2 枚を開くことになる。
 */

import { canBeEmpty } from '../../model/types.js';
import type { AccessSpec, EntitySpec, SpecModel, EventDef, StateMachineSpec } from '../../model/types.js';
import { actorEntity } from '../../usecase/param-source-facts.js';
import type { DataTableSpecModel } from '../../model/data/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { VerifyContext, Verifier } from '../../check-api/contract.js';
import { inputValue } from '../../kernel/input-state.js';

/** 定型 RPC の引数名の前置(`rpc-params.ts` と同じ規約)。 */
const PARAM_PREFIX = 'p_';

/**
 * その機械の遷移 RPC(`apply_{機械}_transition`)が受け取る引数名。
 *
 * data_table を使えない構成(未選択・阻害。見ていないことは実行ログが報告する)・その表に遷移 RPC が無い構成では
 * null を返し、呼び手は口の検査を飛ばす(宣言の整合だけを見る)。
 */
function transitionParams(
  dataTables: DataTableSpecModel | undefined,
  aggregate: string,
  machine: string,
): ReadonlySet<string> | null {
  if (dataTables === undefined || !dataTables.available) return null;
  const table = dataTables.tables.find((candidate) => candidate.entity === aggregate);
  const fn = table?.functions.find(
    (candidate) => candidate.kind === 'rpc' && candidate.name === `apply_${machine}_transition`,
  );
  return fn === undefined ? null : new Set(fn.params);
}

/** `records_actor` の列に値の口(`p_{列}` の引数)が無い。 */
function missingParam(id: string, entity: EntitySpec, column: string, fn: string): Finding {
  return v19({
    message: `${id} の records_actor が指す ${entity.entity}.${column} を書く引数が ${fn} にありません`,
    location: { file: entity.location.file, pointer: `records_actor.${column}` },
    suggestion:
      `${entity.entity} の data_table の ${fn} に引数 ${PARAM_PREFIX}${column} を足す` +
      '(実行者の値は呼び出し側から届くので、口が無いと UPDATE 文にその列が一度も現れない)。' +
      '足せないなら records_actor から外す —— 宣言だけがあって本文が何もしない状態を残さない',
    counterexample: { event: id, column, function: fn },
  });
}

/** 1 つの集約の全イベントの `records_actor` を見る。 */
function checkAggregate(model: SpecModel, aggregate: string, dataTables?: DataTableSpecModel): Finding[] {
  const specs = model.aggregates.get(aggregate);
  const entity = specs?.entity;
  if (specs === undefined || entity === undefined) return [];
  const actor = actorEntity(model);
  const declared = new Set(specs.access?.transitionWrites ?? []);
  const findings: Finding[] = specs.access === undefined ? [] : checkDeclaration(specs.access, specs.stateMachines, entity);
  for (const machine of specs.stateMachines) {
    const params = transitionParams(dataTables, aggregate, machine.machine);
    for (const event of machine.events) {
      findings.push(...checkClears(machine.machine, event, entity, declared));
      findings.push(...checkRecordsTime(machine.machine, event, entity, declared));
      for (const column of event.recordsActor ?? []) {
        const field = entity.fields.find((candidate) => candidate.name === column);
        if (field === undefined) {
          findings.push(
            v19({
              message: `${machine.machine}.${event.id} の records_actor が指す ${entity.entity}.${column} は実在しません`,
              location: event.location,
              suggestion: `${entity.entity} の entity.md に ${column} を足すか、records_actor の綴りを直す`,
              counterexample: { event: `${machine.machine}.${event.id}`, column },
            }),
          );
          continue;
        }
        if (field.type.kind !== 'ref' || field.type.entity !== actor) {
          findings.push(
            v19({
              message: `${machine.machine}.${event.id} の records_actor が指す ${entity.entity}.${column} は実行者への参照ではありません`,
              location: event.location,
              suggestion:
                `records_actor に書けるのは ref(${actor ?? '実行者の集約'}) 型の列だけである` +
                '(書き留めるのは実行者そのものだから)。実行者以外の値を書くなら action_spec の computes を使う',
              counterexample: { event: `${machine.machine}.${event.id}`, column, type: field.type.kind },
            }),
          );
          continue;
        }
        if (!declared.has(column)) {
          findings.push(undeclaredFinding('records_actor', `${machine.machine}.${event.id}`, event, entity, column));
        }
        if (params !== null && !params.has(`${PARAM_PREFIX}${column}`)) {
          findings.push(
            missingParam(`${machine.machine}.${event.id}`, entity, column, `apply_${machine.machine}_transition`),
          );
        }
      }
    }
  }
  return findings;
}

/** この検証器の ID。 */
export const VERIFIER_ID = 'V19';

/** V19 の指摘を組み立てる。 */
export function v19(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/**
 * その列が実在しないことの違反。
 *
 * @param word 宣言の語(`clears` / `records_time`)
 * @param id `{機械}.{イベント}`
 * @param event イベント定義(位置に使う)
 * @param entity その集約の entity_spec
 * @param column 列名
 * @returns 違反
 */
function missingFinding(
  word: string,
  id: string,
  event: EventDef,
  entity: EntitySpec,
  column: string,
): Finding {
  return v19({
    message: `${id} の ${word} が指す ${entity.entity}.${column} は実在しません`,
    location: event.location,
    suggestion: `${entity.entity} の entity.md に ${column} を足すか、${word} の綴りを直す`,
    counterexample: { event: id, column },
  });
}

/** その列が `transition_writes` に載っていなければ違反。 */
function undeclaredFinding(word: string, id: string, event: EventDef, entity: EntitySpec, column: string): Finding {
  return v19({
    message: `${id} の ${word} が指す ${entity.entity}.${column} は transition_writes に宣言されていません`,
    location: event.location,
    suggestion:
      `${entity.entity} の access.md の transition_writes に ${column} を足す(遷移が書く列であることの集約単位の宣言。` +
      'どの経路も作らない)。writes の by: system の行では満たさない —— その行は内部実行が編集で書ける許可であり、' +
      `入口の追えない書き込みの経路を作る。足せないなら ${word} から外す`,
    counterexample: { event: id, column },
  });
}

/**
 * `transition_writes` の宣言そのものを見る(実在しない列・どの遷移も書かない列は腐った宣言)。
 *
 * @param access その集約の access_spec
 * @param machines その集約の状態機械
 * @param entity その集約の entity_spec
 * @returns 違反のリスト
 */
function checkDeclaration(
  access: AccessSpec,
  machines: readonly StateMachineSpec[],
  entity: EntitySpec,
): Finding[] {
  const written = new Set(
    machines.flatMap((machine) =>
      machine.events.flatMap((event) => [...(event.recordsActor ?? []), ...(event.recordsTime ?? []), ...(event.clears ?? [])]),
    ),
  );
  return access.transitionWrites.flatMap((column) => {
    const location = { file: access.location.file, pointer: `transition_writes.${column}` };
    if (!entity.fields.some((field) => field.name === column)) {
      return [
        v19({
          message: `${entity.entity} の transition_writes が指す ${entity.entity}.${column} は実在しません`,
          location,
          suggestion: `${entity.entity} の entity.md に ${column} を足すか、transition_writes の綴りを直す`,
          counterexample: { column },
        }),
      ];
    }
    if (written.has(column)) return [];
    return [
      v19({
        message: `${entity.entity} の transition_writes は ${column} を載せていますが、どの遷移も records_actor / records_time / clears でこの列を書きません(腐った宣言です)`,
        location,
        suggestion: 'transition_writes から外す(遷移が書く列を足すときは、そのときに宣言し直す)',
        counterexample: { column },
      }),
    ];
  });
}

/** 同じイベントが同じ列を 2 つの語に並べていれば違反。 */
function overlapFinding(
  id: string,
  event: EventDef,
  entity: EntitySpec,
  column: string,
  words: readonly [string, string],
): Finding {
  return v19({
    message: `${id} は ${entity.entity}.${column} を ${words[0]} と ${words[1]} の両方に並べています`,
    location: event.location,
    suggestion:
      'その遷移がその列に何をするのかを 1 つに決める(実行者を書き留める / 「いま」を書き留める / ' +
      '空にする は同時には成り立たない)。別のイベントなら並べてよい —— ' +
      '「保管が保管日時を書き、復元が空に戻す」はその形である',
    counterexample: { event: id, column },
  });
}

/**
 * 1 つのイベントの `clears` を見る(実在・空にできること・`transition_writes` の宣言・両立しないこと)。
 *
 * @param machine 機械名
 * @param event イベント定義
 * @param entity その集約の entity_spec
 * @param declared `transition_writes` に載っている列
 * @returns 違反のリスト
 */
function checkClears(machine: string, event: EventDef, entity: EntitySpec, declared: ReadonlySet<string>): Finding[] {
  const id = `${machine}.${event.id}`;
  const recorded = new Set(event.recordsActor ?? []);
  const timed = new Set(event.recordsTime ?? []);
  const findings: Finding[] = [];
  for (const column of event.clears ?? []) {
    const field = entity.fields.find((candidate) => candidate.name === column);
    if (field === undefined) {
      findings.push(missingFinding('clears', id, event, entity, column));
      continue;
    }
    if (!canBeEmpty(field)) {
      findings.push(
        v19({
          message: `${id} の clears が指す ${entity.entity}.${column} は行では必ず値がある列なので空にできません`,
          location: event.location,
          suggestion:
            `${column} を任意の列にする(entity.md の required を外す。auto: true / state(...) の列は` +
            'そもそも行に必ず値があるので空にできない)か、clears から外す。' +
            '行に必ず値がある列を空にする遷移は、行の意味が壊れる書き込みである',
          counterexample: { event: id, column },
        }),
      );
    }
    if (recorded.has(column)) {
      findings.push(overlapFinding(id, event, entity, column, ['records_actor', 'clears']));
    }
    if (timed.has(column)) {
      findings.push(overlapFinding(id, event, entity, column, ['records_time', 'clears']));
    }
    if (!declared.has(column)) findings.push(undeclaredFinding('clears', id, event, entity, column));
  }
  return findings;
}

/**
 * 1 つのイベントの `records_time` を見る。
 *
 * 見るのは 4 点である:
 *   (a) その集約に**実在する**
 *   (b) **`datetime` 型**である —— 書き留めるのは時刻だから(日付だけの `date` も採らない。
 *       「押した瞬間」は時刻であり、日付に丸めるのは表示の判断である)
 *   (c) **行で必ず値がある列ではない**(`required` / `auto` / `state(...)` を弾く)——
 *       `records_time` の意味は「この遷移より前は**まだ起きていない** = 空である」であり、
 *       生まれた瞬間から値がある列はその意味を運べない(作成の側に値の口が開き、
 *       「状態 ⇔ 欄の有無」の同値も成り立たなくなる)。判定は `clears` と同じ `canBeEmpty` 1 本
 *   (d) `access_spec` の `transition_writes` に載っている
 *
 * **値の口(`p_{列}` の引数)は見ない** —— 書く値は SQL の `now()` であり、呼び出し側から
 * 届くものではないので引数は要らない(`records_actor` だけが口を要る。`rpc-columns.ts`)。
 *
 * @param machine 機械名
 * @param event イベント定義
 * @param entity その集約の entity_spec
 * @param declared `transition_writes` に載っている列
 * @returns 違反のリスト
 */
function checkRecordsTime(machine: string, event: EventDef, entity: EntitySpec, declared: ReadonlySet<string>): Finding[] {
  const id = `${machine}.${event.id}`;
  const recorded = new Set(event.recordsActor ?? []);
  const findings: Finding[] = [];
  for (const column of event.recordsTime ?? []) {
    const field = entity.fields.find((candidate) => candidate.name === column);
    if (field === undefined) {
      findings.push(missingFinding('records_time', id, event, entity, column));
      continue;
    }
    if (field.type.kind !== 'datetime') {
      findings.push(
        v19({
          message: `${id} の records_time が指す ${entity.entity}.${column} は datetime 型ではありません`,
          location: event.location,
          suggestion:
            'records_time に書けるのは datetime 型の列だけである(書き留めるのは「押した瞬間」であり、' +
            '日付に丸めるのは表示の判断である)。実行者を書き留めるなら records_actor、' +
            '純関数が決める値なら action_spec の computes を使う',
          counterexample: { event: id, column, type: field.type.kind },
        }),
      );
      continue;
    }
    if (!canBeEmpty(field)) {
      findings.push(
        v19({
          message: `${id} の records_time が指す ${entity.entity}.${column} は行では必ず値がある列です`,
          location: event.location,
          suggestion:
            `${column} を任意の列にする(entity.md の required を外す。auto: true の列は作成時刻であり、` +
            '遷移が書き直す列ではない)か、records_time から外す。' +
            'records_time は「この遷移より前はまだ起きていない = 空である」列の宣言である',
          counterexample: { event: id, column },
        }),
      );
    }
    if (recorded.has(column)) {
      findings.push(overlapFinding(id, event, entity, column, ['records_actor', 'records_time']));
    }
    if (!declared.has(column)) findings.push(undeclaredFinding('records_time', id, event, entity, column));
  }
  return findings;
}

/** V19 の実装。 */
export const recordsActorVerifier: Verifier = {
  id: VERIFIER_ID,
  title:
    '遷移が自分の列に何をするか — records_actor / records_time / clears は実在し、' +
    '型が合い、transition_writes に載り、値の口がある',

  verify(model: SpecModel, ctx: VerifyContext): Finding[] {
    return [...model.aggregates.keys()].flatMap((aggregate) => checkAggregate(model, aggregate, inputValue(ctx.dataTables)));
  },
};
