/**
 * トリガの**発火の宣言**(`triggers[].fires`)の読み取り。
 *
 * `fires` は `create trigger` の 1 行目をそのまま書く欄である(生成器はこの字面を SQL に
 * 写し、`on {表}` と `for each row` を足す。`ddl-guards.ts`)。長いあいだ**宣言のみ**で、
 * 実 DB との突合は名前と関数と「コミット時評価か」だけだった —— INSERT を見ているつもりの
 * トリガが UPDATE しか見ていなくても、誰も赤くならなかった。
 *
 * ここはその字面を **`pg_trigger.tgtype` と比べられる形**(いつ・何で・何ごとに)に割る
 * 純関数である。比べる側は統合テスト(`data-table-parity`)であり、期待表
 * (`data-table-expectations.ts`)がこの結果を運ぶ。**実 DB 側の `tgtype` を同じ形へ割るのは
 * 突合の SQL そのもの**である —— ビット割りは Postgres の定義であってこの仕組みの判断では
 * ないので、写しを 2 つ持たずに読む場所(`pg_catalog` を読むクエリ)に置いてある。
 *
 * ## 読み方
 *
 * ```text
 * {before|after} {insert|update|delete|truncate}[ or …] [of {列, …}] [on {表}] [(注記)]
 * ```
 *
 * - **列の並び(`of …`)は読み飛ばす。** 突合するのは「いつ・何で・何ごとに」の 3 つだけで
 *   あり、列まで見るかは別の判断である(`tgattr` を読む必要がある)。読み飛ばしは
 *   **語順に依らない** —— `of` から次の `or` までを列の並びとして落とすので、
 *   `before update of checked or insert` のように列の後ろへイベントを書いても取り落とさない
 *   (`of` より後ろを丸ごと捨てる形では `insert` が消え、**偽の赤**になった。独立レビュー 2026-09-23)。
 * - **注記の括弧は落とす。** `(constraint trigger, deferrable initially deferred)` は
 *   人向けの但し書きであり、コミット時評価そのものは `deferred:` が別に宣言している。
 * - **`when (…)` の条件は `condition` に運ぶ**(点検 20 回目 C20-7)。実 DB の `pg_trigger.tgqual` と突合する(data-table-parity)。括弧の釣り合いで
 *   切り出し、残りの字面から落とす。生成器の節(`firesClause`)は条件を**そのまま末尾に運び**、`create trigger` の正しい位置
 *   (`for each row` の後)に置くのは `ddl-guards.ts` の 1 か所である(点検 21 回目 C21-5。以前は節が条件を黙って捨て、宣言が受け付けた
 *   条件が生成物から消えて、実 DB の突合で初めて赤になった)。
 * - **`for each …` は宣言に現れない**(生成器が `for each row` を足す)。だから既定は行で
 *   あり、文トリガを宣言するときだけ `for each statement` と書く。
 *
 * 読めなかったときは**黙って諦めない** —— `timing: null` / `events: []` を返し、突合の側が
 * 「宣言が読めない」として落とす(生成器は throw しない)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

/** いつ実行するか。 */
export type FiresTiming = 'before' | 'after';

/** 何ごとに実行するか。 */
export type FiresLevel = 'row' | 'statement';

/** `create trigger` が取りうるイベントの語(この順で並べ直す)。 */
const EVENTS: readonly string[] = ['insert', 'update', 'delete', 'truncate'];

/** 発火の宣言を割った結果(突合の単位)。 */
export interface FiresPlan {
  /** 宣言の字面そのまま(報告に出すため。読めなかったときの手がかりでもある)。 */
  readonly declared: string;
  /** いつ実行するか。読めなければ null。 */
  readonly timing: FiresTiming | null;
  /** 何で実行するか(`EVENTS` の順に正規化。読めなければ空)。 */
  readonly events: readonly string[];
  /** 何ごとに実行するか(宣言が無ければ行)。 */
  readonly level: FiresLevel;
  /** `when (…)` の条件(括弧の中の字面。無ければ null)。 */
  readonly condition: string | null;
}

/**
 * `when (…)` の条件を括弧の釣り合いで切り出し、それを除いた字面と一緒に返す(閉じていなければ条件は無いとして字面を残す)。
 *
 * @param declared `triggers[].fires` の字面
 * @returns 条件を除いた字面と条件
 */
export function splitCondition(declared: string): { readonly rest: string; readonly condition: string | null } {
  const head = /\bwhen\s*\(/i.exec(declared);
  if (head === null) return { rest: declared, condition: null };
  const open = head.index + head[0].length - 1;
  let depth = 0;
  for (let at = open; at < declared.length; at += 1) {
    if (declared[at] === '(') depth += 1;
    else if (declared[at] === ')') depth -= 1;
    if (depth === 0) return { rest: `${declared.slice(0, head.index)} ${declared.slice(at + 1)}`, condition: declared.slice(open + 1, at).trim() };
  }
  return { rest: declared, condition: null };
}


/**
 * `create trigger` の**発火の節**として流せる字面(注記・`on {表}`・`for each …` を落とす)。
 *
 * 生成器は `on {表}` と `for each row` を自分で付けるので、宣言の字面からそれを落とす必要が
 * ある(`ddl-copy-triggers.ts` は表名を書いた宣言を**生成しない**線で避けているが、条件を
 * 課すトリガの宣言には表名も注記も普通に書いてある)。**読めない宣言では null を返す** ——
 * いつ(before / after)と何で(insert / update / …)のどちらかが読めなければ、
 * 流せる節を組み立てられない。
 *
 * 列の名指し(`of …`)は**残す** —— そこがこの種のトリガを行の CHECK ではなくトリガにして
 * いる理由そのものである(既存の違反行を別の列だけ直すときに失敗しない)。`when (…)` の条件は字面のまま `condition` に運ぶ
 * (置き場は `ddl-guards.ts` が決める。点検 21 回目 C21-5・22 回目 O22-4)。
 *
 * @param declared `triggers[].fires` の字面
 * @returns 流せる節と条件、または読めなければ null
 */
export function firesClause(declared: string): TriggerFires | null {
  const plan = parseFires(declared);
  if (plan.timing === null || plan.events.length === 0) return null;
  const { rest, condition } = splitCondition(declared);
  const clause = strip(rest);
  if (clause === '') return null;
  return condition === null ? { fires: clause } : { fires: clause, condition };
}

/** 生成する `create trigger` の発火の節と、`for each row` の後に置く条件(`DdlTrigger` に渡す形)。 */
export interface TriggerFires {
  /** 発火の節(`when (…)` を含まない)。 */
  readonly fires: string;
  /** `when (…)` の括弧の中(無ければ欄が無い)。 */
  readonly condition?: string;
}

/**
 * 宣言の字面を、生成する `create trigger` の発火の節と条件に分ける(字面は注記を落とさず、条件の無い宣言は 1 字も変えない —— 適用済みの
 * migration と同じ字面)。`when (…)` の読みは宣言の側ではここと `firesClause` の 2 つの口だけで、`ddl-guards.ts` は割り直さない
 * (点検 22 回目 C の O22-4。以前は `firesClause` が末尾に付けた条件を `ddl-guards.ts` がもう一度割っていた)。
 *
 * @param declared 発火の宣言の字面
 * @returns 発火の節と条件
 */
export function triggerFires(declared: string): TriggerFires {
  const { rest, condition } = splitCondition(declared);
  return condition === null ? { fires: declared } : { fires: rest.trim().replace(/\s+/g, ' '), condition };
}

/** 注記の括弧・`on {表}`・`for each …` を落として、語だけを残す。 */
function strip(source: string): string {
  return source
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bfor\s+each\s+(row|statement)\b/g, ' ')
    .replace(/\bon\s+[a-z0-9_."]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 発火の宣言を割る。
 *
 * @param declared `triggers[].fires` の字面
 * @returns 割った結果(読めなかった部分は null / 空で返る)
 */
export function parseFires(declared: string): FiresPlan {
  const { rest: unconditioned, condition } = splitCondition(declared);
  const level: FiresLevel = /\bfor\s+each\s+statement\b/i.test(unconditioned) ? 'statement' : 'row';
  const words = strip(unconditioned).split(' ').filter((word) => word !== '');
  const first = words[0];
  const timing: FiresTiming | null = first === 'before' || first === 'after' ? first : null;
  const rest = timing === null ? words : words.slice(1);
  const seen = new Set<string>();
  const unknown: string[] = [];
  // `of` から次の `or` までは列の並びである(列の名前はイベントの語ではないので読み飛ばす)。
  // SQL の文法どおり —— 列はカンマ区切り、イベントは `or` 区切りである。
  let inColumns = false;
  for (const word of rest) {
    if (word === 'or') {
      inColumns = false;
      continue;
    }
    if (word === 'of') {
      inColumns = true;
      continue;
    }
    if (EVENTS.includes(word)) {
      seen.add(word);
      inColumns = false;
      continue;
    }
    // 列の並びの中の語は列の名前である。外に出てきた知らない語は「読めない」に倒す。
    if (!inColumns) unknown.push(word);
  }
  const events = unknown.length > 0 ? [] : EVENTS.filter((event) => seen.has(event));
  return { declared, timing, events, level, condition };
}

/**
 * 更新で発火するとき、**どの列の更新を見ているか**。
 *
 * `update of {列, …}` と書いてあればその列、列を名指さない `update` は**どの列の更新でも**
 * 発火する(`'all'`)。更新で発火しない宣言は null。`parseFires` が読み飛ばす列の並びを、
 * 「元の列が動いたら追随する」ことを確かめる側(T15)のために取り出す。
 *
 * **混在の読み**: `update of a or update`(列の指定ありと列の指定なしの混在)は `['a']` と読む。実際はどの列の
 * 更新でも発火するが、ここは「列を名指した更新があるか」を見て、名指しが 1 つでもあればその列だけを返す。
 * これは**安全側**である —— 唯一の読み手(`follow` が元の列の更新を含むかの検査)にとって、狭く読むことは
 * 「含まない」と言いすぎる(宣言が正しいのに error を出す)方向にしか誤らず、含むと言いすぎて嘘の宣言を通す
 * ことは無い。混在はほぼ書かれず、書いて怒られたら `update` だけ(または列を並べる)に直せば通る。
 *
 * @param declared `triggers[].fires` の字面
 * @returns 見ている列(小文字)・`'all'`・更新で発火しないなら null
 */
export function updatedColumnsOf(declared: string): readonly string[] | 'all' | null {
  const words = strip(splitCondition(declared).rest).split(' ').filter((word) => word !== '');
  const columns: string[] = [];
  let sawUpdate = false;
  let named = false;
  let inColumns = false;
  for (const word of words) {
    if (word === 'or') {
      inColumns = false;
    } else if (inColumns) {
      columns.push(...word.split(',').filter((column) => column !== ''));
    } else if (word === 'update') {
      sawUpdate = true;
    } else if (word === 'of' && sawUpdate) {
      inColumns = true;
      named = true;
    }
  }
  if (!sawUpdate) return null;
  return named ? columns : 'all';
}

/**
 * 発火の宣言が更新で発火するか(宣言が無い・読めないときは発火する側に倒す)。「作成の後に書き換わる列」の定義
 * (`model/written-after-create.ts`)が、更新で発火する供給を数えるのに使う(model の層は発火の宣言を読まないので、呼び手がこれを渡す)。
 *
 * @param fires `triggers[].fires` の字面(無ければ undefined)
 * @returns 更新で発火するなら true
 */
export function firesOnUpdate(fires: string | undefined): boolean {
  if (fires === undefined) return true;
  const plan = parseFires(fires);
  return plan.timing === null || plan.events.includes('update');
}
