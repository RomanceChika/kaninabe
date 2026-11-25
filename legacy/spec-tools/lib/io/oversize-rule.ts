/**
 * 「300 行を超えるファイルの宣言」の判定を**仕組み側のパッケージ(`@kaninabe/lint-config`)から借りる**口(io 層)。
 *
 * 判定の本体は `framework/lint-config/src/oversize.mjs` の純関数 1 本で、3 つの木の lint(自作規則
 * `layer/declared-oversize`)と、verify の W 群が宣言の本数を数えるのが**同じ関数を呼ぶ**
 * (数え方を 2 本書かない)。`@kaninabe/spec-tools` は `@kaninabe/lint-config` を `file:` の依存に持つ(ワークスペースには
 * 入れない。ADR-0013)ので、**道具自身の位置から名前で解く**(`@kaninabe/lint-config/oversize`)。
 * **走査する木の根(`repoRoot`)からは引かない**: 通し実行の一時ツリー(fixture)には仕組みの
 * パッケージが無いが、判定の道具は常に本物のパッケージのものを使う。
 *
 * `.mjs`(ESM)を同期で読むので `createRequire` を通す(`require(esm)`。Node 24 の標準)。
 */

import { createRequire } from 'node:module';

/** 1 ファイルの判定(`oversize.mjs` の `judgeOversize` の返り値)。 */
export interface OversizeJudgement {
  /** 行数(`max-lines` と同じ数え方。空行・コメントを含む)。 */
  readonly lines: number;
  /** 信号の行数を超えているか。 */
  readonly exceeds: boolean;
  /** 超えていて、宣言(`@oversize` と `@split-review`)が正しく揃っているか。 */
  readonly declared: boolean;
  /** `@split-review` の本文(ラベルを含む。無ければ null)。 */
  readonly splitReview: string | null;
  /** 違反(空なら通る)。 */
  readonly problems: readonly { readonly id: string; readonly message: string }[];
}

/** 同じ本文の `@split-review` の組(使い回し)。 */
export interface RepeatedReview {
  /** 整えた本文(ラベル・空白を除く)。 */
  readonly body: string;
  /** その本文を持つファイルの相対パス(昇順)。 */
  readonly files: readonly string[];
}

/** 判定の道具。 */
export interface OversizeRule {
  /** 信号の行数(300)。 */
  readonly OVERSIZE_MAX_LINES: number;
  /** ファイル 1 本の本文に宣言の規則を当てる。 */
  readonly judgeOversize: (text: string, max?: number) => OversizeJudgement;
  /** 使い回しとみなす本数(3)。 */
  readonly REPEATED_REVIEW_MIN: number;
  /** 同じ本文の `@split-review` が閾値以上ある組を返す(ファイルをまたぐ性質)。 */
  readonly repeatedSplitReviews: (
    entries: readonly { readonly file: string; readonly splitReview: string | null }[],
    threshold?: number,
  ) => readonly RepeatedReview[];
}

let cached: OversizeRule | null = null;

/**
 * 判定の道具を読む(1 回だけ。以降は同じものを返す)。
 *
 * @returns 判定の道具(lint の自作規則が呼ぶ関数と同じ実体)
 */
export function loadOversizeRule(): OversizeRule {
  if (cached !== null) return cached;
  const load = createRequire(import.meta.url);
  const loaded: OversizeRule = load('@kaninabe/lint-config/oversize');
  cached = loaded;
  return loaded;
}
