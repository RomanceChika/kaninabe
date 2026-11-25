/**
 * 外へ送る自由文の無害化の語彙(kernel 層 — 全層が読む共通語)。
 *
 * 外部連携カタログの行の `sends.neutralize: [discord_mentions, control_chars, length:2000]` が書く語と、実行時パッケージ `@kaninabe/runtime/neutralize` の部品の対応の**唯一の定義**。
 * 部品の実体は実行時パッケージが持ち(検証器・生成器は実行時パッケージを import しない)、宣言した部品を手書きのアダプタが呼んでいることは X7 が突き合わせる。
 * 部品の名前の綴りが実行時パッケージの export と一致することは `__tests__/unit/kernel/neutralize.test.ts` が見る(食い違うと赤)。
 */

/** 部品を import する実行時パッケージのモジュール。 */
export const NEUTRALIZE_MODULE = '@kaninabe/runtime/neutralize';

/** 引数なしの部品の語。 */
export const PLAIN_NEUTRALIZERS = ['discord_mentions', 'control_chars'] as const;

/** `length:N` の N の上限(宣言の取り違えで巨大な数を書かせない。連携が 1 回で送る自由文の長さとして現実的な桁)。 */
export const NEUTRALIZE_LENGTH_CEILING = 1_000_000;

/** 無害化の部品 1 件の宣言。 */
export type NeutralizerDecl =
  | { readonly kind: 'discord_mentions' }
  | { readonly kind: 'control_chars' }
  | { readonly kind: 'length'; readonly max: number };

/**
 * 語から宣言を引く(`length:N` は N が 1 以上 `NEUTRALIZE_LENGTH_CEILING` 以下の整数のときだけ)。
 *
 * @param word 宣言の 1 語(例: `discord_mentions` / `length:2000`)
 * @returns 宣言。語彙の外なら null
 */
export function parseNeutralizer(word: string): NeutralizerDecl | null {
  const plain = PLAIN_NEUTRALIZERS.find((candidate) => candidate === word);
  if (plain !== undefined) return { kind: plain };
  const match = /^length:([1-9][0-9]{0,6})$/u.exec(word);
  if (match === null) return null;
  const max = Number(match[1]);
  return max <= NEUTRALIZE_LENGTH_CEILING ? { kind: 'length', max } : null;
}

/**
 * 宣言を語に戻す(メッセージ・生成物の字面)。
 *
 * @param decl 宣言
 * @returns 語
 */
export function neutralizerWord(decl: NeutralizerDecl): string {
  return decl.kind === 'length' ? `length:${String(decl.max)}` : decl.kind;
}

/**
 * 宣言の部品がアダプタに要求する、実行時パッケージの export の名前(すべて呼ばれていなければならない)。
 *
 * @param decl 宣言
 * @returns export の名前の並び
 */
export function neutralizerExports(decl: NeutralizerDecl): readonly string[] {
  if (decl.kind === 'discord_mentions') return ['neutralizeDiscordMentions', 'allowedDiscordMentionsOf'];
  if (decl.kind === 'control_chars') return ['stripControlChars'];
  return ['clampLength'];
}
