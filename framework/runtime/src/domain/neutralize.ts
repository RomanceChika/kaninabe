/**
 * 外へ送る自由文の無害化の部品(外部連携カタログの `sends.neutralize` の実体)。
 *
 * **仕様**: 外部連携カタログ(`external.md`)の行の `sends.neutralize: [discord_mentions, control_chars, length:N]`。宣言した部品を手書きのアダプタが
 * 実際に呼んでいることは、検証器の X7 が(import の束縛まで見て)突き合わせる。ASVS V1.3.3(危ない文脈へ渡す値を無害化する)。
 *
 * 宣言の語と部品の対応:
 *   - `discord_mentions` — `neutralizeDiscordMentions`(本文の綴りを壊す)と `allowedDiscordMentionsOf`(呼んでよい相手を、アダプタ自身が置いた先頭のメンションだけに絞る)の**両方**
 *   - `control_chars` — `stripControlChars`
 *   - `length:N` — `clampLength(text, N)`
 *
 * 呼んでよい相手は、アダプタ自身が本文の先頭に置いたメンションだけである。本文の残りには催し名・表示名のような利用者の入力が入り、Discord は既定で
 * 本文中の `@everyone` / `@here` / `<@&ロール>` / `<@ユーザー>` を解釈するので、何もしなければ催し名に `@everyone` と打つだけで全員を呼べてしまう。
 * 二重に塞ぐ: ①`allowed_mentions` で呼べる相手を先頭のメンションに限り、②本文の側でもメンションの綴りを壊す(ゼロ幅スペースを挟む。見た目は変わらず、解釈だけされなくなる)。
 * 純関数であり、throw しない。
 */

/** `allowed_mentions` の形(Discord Webhook の仕様のうち、使う分だけ)。 */
export interface AllowedDiscordMentions {
  /** 綴りから解釈してよい種別。`everyone` は `@everyone` / `@here` を許すときだけ入る。 */
  readonly parse: readonly 'everyone'[];
  /** 呼んでよいユーザーの ID(無ければ欄ごと無い)。 */
  readonly users?: readonly string[];
  /** 呼んでよいロールの ID(無ければ欄ごと無い)。 */
  readonly roles?: readonly string[];
}

/** 見えないが、Discord の字句解析を切る文字(ゼロ幅スペース)。 */
const ZERO_WIDTH_SPACE = '​';

/**
 * 本文の中のメンションの綴りを壊し、呼べないようにする。
 *
 * `@everyone` / `@here` は `@` の直後、`<@…>`(ユーザー・ロール・旧形式の `<@!…>`)は `<@` の間にゼロ幅スペースを挟む。
 * メンションの意図で書かれた本文は無い(呼ぶ相手はアダプタが先頭に置く)ので、本文全体にかけてよい。
 *
 * @param text 利用者の入力を含みうる本文(先頭のメンションは含めない)
 * @returns メンションとして解釈されない本文
 */
export function neutralizeDiscordMentions(text: string): string {
  return text.replaceAll(/@(everyone|here)/g, `@${ZERO_WIDTH_SPACE}$1`).replaceAll('<@', `<${ZERO_WIDTH_SPACE}@`);
}

/**
 * アダプタ自身が置いたメンション(本文の先頭)から、呼んでよい相手の許可を作る。
 *
 * 許可を**置いた綴りそのもの**から導くので、「綴りには出ているのに許可が無い」「許可はあるのに綴りが無い」の食い違いが生まれない。
 * メンションの無い通は `{ parse: [] }`(誰も呼べない)になる。
 *
 * @param prefix 本文の先頭に置いたメンションの文字列(置かなければ空文字)
 * @returns Discord に渡す `allowed_mentions`
 */
export function allowedDiscordMentionsOf(prefix: string): AllowedDiscordMentions {
  // ID だけを取り出す(`<@123>` / 旧形式 `<@!123>` はユーザー、`<@&123>` はロール)。
  const users = prefix.match(/(?<=<@!?)[0-9]+(?=>)/g) ?? [];
  const roles = prefix.match(/(?<=<@&)[0-9]+(?=>)/g) ?? [];
  return {
    parse: /@(everyone|here)/.test(prefix) ? ['everyone'] : [],
    ...(users.length > 0 ? { users } : {}),
    ...(roles.length > 0 ? { roles } : {}),
  };
}

/** 制御文字か(C0 のうち改行・タブ・復帰以外 / DEL / C1)。 */
function isControl(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/**
 * 制御文字を取り除く(改行・タブ・復帰は残す)。端末の制御列・ヌル文字・C1 を、ログ・プロンプト・メッセージの文脈へ運ばない。
 *
 * @param text 利用者の入力を含みうる本文
 * @returns 制御文字を除いた本文
 */
export function stripControlChars(text: string): string {
  let kept = '';
  // 制御文字はすべて BMP の 1 単位なので、UTF-16 の単位ごとに見てよい（サロゲートペアの半分は制御文字ではないので両方残る）。
  for (let index = 0; index < text.length; index += 1) {
    if (!isControl(text.charCodeAt(index))) kept += text.charAt(index);
  }
  return kept;
}

/**
 * 長さを上限に収める(UTF-16 の単位。サロゲートペアを割らない)。上限を超えた分は捨てる。
 *
 * @param text 本文
 * @param max 上限(0 以上の整数。範囲外は 0 として全部捨てる)
 * @returns 上限以下の本文
 */
export function clampLength(text: string, max: number): string {
  const limit = Number.isInteger(max) && max > 0 ? max : 0;
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const last = cut.charCodeAt(cut.length - 1);
  // 末尾が上位サロゲートで終わるなら、ペアの片割れになるので落とす。
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
