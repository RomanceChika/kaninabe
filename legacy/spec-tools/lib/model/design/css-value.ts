/**
 * デザイントークンの**直値**(色以外。長さ・時間・数値・フォント列・影)の綴りの検査(純粋関数)。
 *
 * トークンの値は生成物の CSS(`--名前: 値;`)にそのまま置かれる。自由な文字列を許すと、`;` `}` で宣言とルールを抜けて
 * 任意のルール(`@import`・`background:url(//…)`・属性セレクタでの情報の持ち出し)を足せる。そこで値の**文法**を閉じる:
 *
 *   - 項は 数値(+ 単位 `px` `em` `%` など)・識別子(`serif` `system-ui`)・引用符つきの名前(`"Hiragino Sans"`)・許可した関数の呼び出し
 *   - 関数は `var` `rgb` `rgba` `hsl` `hsla` `calc` `min` `max` `clamp` `cubic-bezier` `steps` だけ(`url` `image` `expression` などは書けない)
 *   - 区切りは空白・`,`。演算子(`+` `-` `*` `/`)は関数の中だけ
 *   - `;` `{` `}` `@` `\` `<` `>` `!` バッククォート・コメント記号・制御文字・hex(`#…`。色は palette が持つ)は書けない
 *
 * 色は palette の名前で参照する(`ref`)ので、ここへは来ない。**アプリの語彙は 1 語も持たない**。
 */

/** 値に書いてよい関数。 */
const FUNCTIONS: ReadonlySet<string> = new Set(['var', 'rgb', 'rgba', 'hsl', 'hsla', 'calc', 'min', 'max', 'clamp', 'cubic-bezier', 'steps']);

/** 値の長さの上限(フォント列の長いものでも十分に収まる)。 */
const MAX_LENGTH = 300;

/** 数値(符号・小数・指数なし)と、それに続く単位。 */
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)[A-Za-z%]*/;

/** 識別子(`--var-name` を含む)。 */
const IDENTIFIER = /^-{0,2}[A-Za-z_][A-Za-z0-9_-]*/;

/** 引用符つきの名前(中身は英数字・空白・`_` `-` `.` だけ)。 */
const QUOTED = /^"[A-Za-z0-9 _.-]*"/;

/**
 * 値の綴りを検査する。
 *
 * @param value トークンの直値
 * @returns 書けない理由(1 行)。書いてよい綴りなら null
 */
export function cssValueProblem(value: string): string | null {
  if (value.trim() === '') return '値が空です';
  if (value.length > MAX_LENGTH) return `値が長すぎます(${MAX_LENGTH} 文字まで)`;
  if (/[;{}@\\<>!`#\u0000-\u001F\u007F-\u009F\u2028\u2029]/u.test(value)) return '値に ; { } @ \\ < > ! # バッククォート・制御文字は書けません';
  if (value.includes('/*') || value.includes('*/')) return '値にコメント記号は書けません';
  const open: string[] = [];
  let rest = value;
  while (rest.length > 0) {
    const first = rest.charAt(0);
    if (first === ' ' || first === ',') {
      rest = rest.slice(1);
      continue;
    }
    if (first === ')') {
      if (open.pop() === undefined) return '閉じ括弧に対応する開き括弧がありません';
      rest = rest.slice(1);
      continue;
    }
    if (open.length > 0 && (first === '+' || first === '-' || first === '*' || first === '/')) {
      rest = rest.slice(1);
      continue;
    }
    const quoted = QUOTED.exec(rest);
    if (quoted !== null) {
      rest = rest.slice(quoted[0].length);
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number !== null) {
      rest = rest.slice(number[0].length);
      continue;
    }
    const identifier = IDENTIFIER.exec(rest);
    if (identifier === null) return `値に書けない文字があります(「${rest.charAt(0)}」の付近)`;
    const word = identifier[0];
    rest = rest.slice(word.length);
    if (rest.startsWith('(')) {
      if (!FUNCTIONS.has(word)) return `値に書けない関数があります(${word})。使えるのは ${[...FUNCTIONS].join(' / ')}`;
      open.push(word);
      rest = rest.slice(1);
    }
  }
  return open.length === 0 ? null : '開き括弧が閉じていません';
}
