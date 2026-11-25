/**
 * 検査の登録の語(kernel 層 — 全層が読む共通語)。
 *
 * 検査 ID(`T8` のような英大文字 1〜2 字と数字)を 1 つの表で列挙するための最小の型と、表の整合を見る純関数。
 * 各群が自分の検査を `CheckEntry` の並びとして export し(`lib/<群>/checks.ts`)、組み立ての根(`lib/compose/all-checks.ts`)が
 * 全群を束ねる。ID の綴りは検査器のファイルの 1 か所にだけ書き、登録の側はそれを参照する(綴りを 2 か所に書かない)。
 *
 * 型と純関数だけで、何も import しない。**アプリの語彙は 1 語も持たない。**
 */

/** 登録された検査 1 本(ID と、人が読む短い題)。 */
export interface CheckEntry {
  /** 検査 ID(例: `T8`)。 */
  readonly id: string;
  /** 人が読む短い題。 */
  readonly title: string;
  /**
   * 同じ ID の段の見分け(1 つの検査が複数の段に分かれている正当な場合の宣言)。
   *
   * 同じ ID を群の中で 2 回以上登録するなら、その段は**全部**これを持ち、互いに違う(例: ジョブの起動口の接地の
   * 「接地」「入口の衝突」「口」)。無い段が 2 つあれば、ID を直し忘れたコピーとして赤になる(`repeatedCheckProblems`)。
   * 免除の表ではなく、段そのものに書く欄である。ID が 1 回しか現れない段は書かなくてよい。
   */
  readonly part?: string;
  /**
   * この段の見る相手(実装の木の側)が**生成物だけで閉じる**こと(題材の通し実行が、生成の後の木でこの段をもう一度回す。fix27 A2)。
   *
   * 題材(仕様だけの製品)の通し実行は、実装の木を置く前に verify を回す(置くと手書きの実装との突合が全部落ちる)ので、実装の木を読む段は
   * ふだん飛ぶ。そのうち HTTP の入口・有料の口のように**相手が生成した口でも成り立つ段**は、生成の後の木で回し直せば題材の上でも効く。
   * 回し直す部分集合はこの欄から導く(別の表を持たない。`lib/compose/all-checks.ts` の `generatedTreeCheckIds`)。手書きの実装(ジョブの起動口・
   * 枠の Cron の登録)を相手にする段には付けない —— 題材にはその相手が無く、回し直すと「無い」と言うだけになる。
   */
  readonly onGeneratedTree?: true;
}

/** 1 つの群が登録した検査の並び。 */
export interface CheckGroup {
  /** 群の名前(重複の報告に出す。人が読む名前でよい)。 */
  readonly group: string;
  /** 群の検査(同じ ID が群の中に複数あるときは、その段が全部 `part` を持つ。表では 1 本に数える)。 */
  readonly checks: readonly CheckEntry[];
}

/** 群の中で同じ ID の段が宣言を欠いている 1 件。 */
export interface RepeatedCheckProblem {
  /** 群の名前。 */
  readonly group: string;
  /** 同じ ID が複数ある検査 ID。 */
  readonly id: string;
  /** 何が欠けているか。 */
  readonly problem: 'missing_part' | 'same_part';
  /** 問題のある段の `part`(無い段は空文字。見つけた順)。 */
  readonly parts: readonly string[];
}

/**
 * 群の中で同じ ID を複数の段が登録しているとき、それが「同じ検査の一部」の宣言(`part`)で区別されているかを見る。
 *
 * `part` の無い段が混じる(コピーして ID を直し忘れた形)か、`part` が互いに違わない場合を返す。ID が 1 回しか現れない
 * 検査は見ない(`part` は要らない)。
 *
 * @param groups 群ごとの登録(畳む前の並び)
 * @returns 宣言を欠いた同じ ID(無ければ空)
 */
export function repeatedCheckProblems(groups: readonly CheckGroup[]): readonly RepeatedCheckProblem[] {
  const problems: RepeatedCheckProblem[] = [];
  for (const { group, checks } of groups) {
    const byId = new Map<string, string[]>();
    for (const entry of checks) byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry.part ?? '']);
    for (const [id, parts] of byId) {
      if (parts.length < 2) continue;
      if (parts.includes('')) problems.push({ group, id, problem: 'missing_part', parts });
      else if (new Set(parts).size !== parts.length) problems.push({ group, id, problem: 'same_part', parts });
    }
  }
  return problems;
}

/** 全群を束ねた表の 1 行(どの群の検査か)。 */
export interface RegisteredCheck extends CheckEntry {
  /** 登録した群。 */
  readonly group: string;
}

/**
 * 同じ ID の段を 1 本に畳む(最初に現れた題を残す)。
 *
 * 1 つの検査 ID が複数の段に分かれている群(例: ジョブの起動口の接地は 1 つの ID を複数の検証器が受け持つ)のため、
 * 表に載せるときは畳む。畳んでよいのは、段が `part` で「同じ検査の一部」と宣言しているときだけである
 * (`repeatedCheckProblems` が見る。畳みはその検査とは別に、表の行を作る道具である)。
 *
 * @param entries 登録した検査(重複を含みうる)
 * @returns ID ごとに 1 本の並び(初出の順)
 */
export function distinctChecks(entries: readonly CheckEntry[]): readonly CheckEntry[] {
  const seen = new Set<string>();
  const result: CheckEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push({ id: entry.id, title: entry.title });
  }
  return result;
}

/**
 * 全群の検査を 1 本の並びに束ねる(群の順・群の中の順を保つ)。
 *
 * @param groups 群ごとの登録
 * @returns どの群の検査かを持つ行の並び(群の中で同じ ID の段は畳んである)
 */
export function flattenCheckGroups(groups: readonly CheckGroup[]): readonly RegisteredCheck[] {
  return groups.flatMap(({ group, checks }) => distinctChecks(checks).map((entry) => ({ ...entry, group })));
}

/** 同じ ID を複数の群が登録している 1 件。 */
export interface DuplicateCheckId {
  /** 重複した ID。 */
  readonly id: string;
  /** 登録した群(初出の順)。 */
  readonly groups: readonly string[];
}

/**
 * 同じ ID を 2 つ以上の群が登録していないかを見る(群の中で同じ ID の段は畳むので数えない)。
 *
 * @param groups 群ごとの登録
 * @returns 重複した ID と登録した群(無ければ空)
 */
export function duplicateCheckIds(groups: readonly CheckGroup[]): readonly DuplicateCheckId[] {
  const owners = new Map<string, string[]>();
  for (const row of flattenCheckGroups(groups)) {
    const groupsOfId = owners.get(row.id) ?? [];
    groupsOfId.push(row.group);
    owners.set(row.id, groupsOfId);
  }
  return [...owners]
    .filter(([, groupsOfId]) => groupsOfId.length > 1)
    .map(([id, groupsOfId]) => ({ id, groups: groupsOfId }));
}
