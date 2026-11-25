/**
 * `probe` に書いてよいコマンドと位置の**閉じた許可表**(置き場を覗く手の安全側の縛り)。
 *
 * `probe` の `kind` が 2 語しかないことは「値を返す形が宣言できない」ことの担保だが、`kind: command` は
 * 宣言した argv をそのまま実行する。仕様の束は信頼できない入力でありうる(敵対的な PR が `config.md` の
 * 1 行を変える)ので、**実行してよいのは読み取り専用の列挙の形だけ**にする。外れる宣言は検証器が
 * エラーにし、実行器(製品の config 道具の `probe-guard.ts`)も同じ表で実行前に拒む(二重)。
 *
 * 守るもの:
 *   1. `argv` は下の表のどれかに**全体が**一致する。`sh -c` / `node -e` / 任意の実行ファイル / パスつきの実行ファイル
 *      (`/bin/sh` `./x`)/ 未知のサブコマンド / 余分な引数は一致しない
 *   2. `npx` 経由は**書けない**。`npx`(npm exec)は cwd から上の `node_modules` に同じ版と称するものがあればそれを実行し、
 *      cwd の `.npmrc` の `node-options` を子に渡すので、仕様の束に植えたファイルでコードが動く(4 回目 C4-3)。版を固定しても
 *      任意の完全な版を通していた(C4-9)。Vercel の CLI は人が入れたもの(`vercel login` 済みのもの)を `vercel` で呼ぶ
 *      (`gh` / `supabase` と同じ扱い。実行器は根の中の実行ファイルを PATH から拾わない — 製品の config 道具の `probe.ts` の
 *      `commandRunner` が、PATH から根の中・`node_modules` の要素を落としてから名前を引く。6 回目 C6-4)
 *   3. `cwd` は**閉じた表**(`.` と `app`)のどれか。`dotenv.path` は**リポジトリの根の中の相対パス**だけ(`..`・絶対パス・
 *      ドライブ名・`~`・バックスラッシュ・NUL は拒む)。シンボリックリンクで外へ出るかは、ファイルシステムを見る実行器が追加で見る
 *
 * 表の写しが製品の config 道具の `probe-guard.ts` にある(別のツールチェーンなので import できない)。
 * 同じ判定になることは `__tests__/unit/model/config/probe-policy-parity.test.ts` が見張る。
 */

/** 語 1 つ: 文字列は一字一句の一致、正規表現は全体の一致。 */
type Token = string | RegExp;

/** 環境の名前(`production` / `preview` など。Vercel の環境名)。 */
const ENVIRONMENT_NAME = /^[a-z][a-z0-9_-]{0,31}$/;

/** Supabase のプロジェクト参照(英小文字と数字の 20 字)。 */
const SUPABASE_PROJECT_REF = /^[a-z0-9]{20}$/;

/** 許可する argv の形。**ここに無い形は実行できない。** */
/**
 * 許可する argv の形。**ここに無い形は実行できない。** 1 行 1 形・空白区切りで、`<…>` の語は正規表現の位置。
 * (コマンド行の綴りとして 1 本の文字列に書く。語を 1 つずつ配列のリテラルにすると、仕様の語彙の id と
 * 偶然一致する語が W1 に当たるため、また形を 1 行で読めるようにするため。)
 */
const SHAPE_LINES: readonly string[] = [
  'gh secret list --json name',
  'vercel env ls <environment>',
  'supabase secrets list',
  'supabase secrets list --project-ref <project-ref>',
];

const PLACEHOLDERS: Readonly<Record<string, RegExp>> = {
  '<environment>': ENVIRONMENT_NAME,
  '<project-ref>': SUPABASE_PROJECT_REF,
};

/** 許可表(語の並び)。 */
export const PROBE_COMMAND_SHAPES: readonly (readonly Token[])[] = SHAPE_LINES.map((line) =>
  line.split(' ').map((word): Token => PLACEHOLDERS[word] ?? word),
);

/** 違反のときに出す対処(許可表を人に見せる)。 */
export const PROBE_COMMAND_SUGGESTION =
  'argv を許可表の形だけで書く: `gh secret list --json name` / ' +
  '`vercel env ls {環境名}` / `supabase secrets list [--project-ref {20字}]`' +
  '(シェル・任意の実行ファイル・パスつきの実行ファイル・npx は書けない。CLI は人が入れたものを名前で呼ぶ)';

function tokenMatches(token: Token, word: string): boolean {
  return typeof token === 'string' ? token === word : token.test(word);
}

/**
 * argv が許可表のどれかに全体で一致するか。
 *
 * @param argv 宣言された argv
 * @returns 一致すれば null、外れれば理由(1 行)
 */
export function commandProbeProblem(argv: readonly string[]): string | null {
  if (argv.length === 0) return 'argv が空です';
  const matched = PROBE_COMMAND_SHAPES.some(
    (shape) => shape.length === argv.length && shape.every((token, index) => tokenMatches(token, argv[index] ?? '')),
  );
  if (matched) return null;
  return `argv の形が許可表にありません(先頭の語: ${JSON.stringify(argv[0])}、全体で ${argv.length} 語)`;
}

/** `cwd` に書ける位置の**閉じた表**(リポジトリの根と製品の実装の木。4 回目 C4-3)。 */
export const PROBE_CWD_CHOICES: readonly string[] = ['.', 'app'];

/**
 * `cwd` が閉じた表のどれかか(一字一句。`./app` や `app/` の表記ゆれも拒む)。
 *
 * @param cwd 宣言された `cwd`
 * @returns 表にあれば null、外れれば理由(1 行)
 */
export function commandCwdProblem(cwd: string): string | null {
  return PROBE_CWD_CHOICES.includes(cwd) ? null : `cwd ${JSON.stringify(cwd)} は書ける位置の表(${PROBE_CWD_CHOICES.join(' / ')})にありません`;
}

/**
 * パスが「リポジトリの根の中の相対パス」の綴りか(ファイルシステムは見ない)。
 *
 * @param path 宣言されたパス(`cwd` / `dotenv.path`)
 * @returns 綴りが正しければ null、外れれば理由(1 行)
 */
export function rootRelativePathProblem(path: string): string | null {
  if (path === '') return 'パスが空です';
  if (path.includes('\0')) return 'パスに NUL が含まれています';
  if (path.includes('\\')) return 'パスにバックスラッシュが含まれています(区切りは / だけ)';
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return `パス ${path} は絶対パスです`;
  if (path.startsWith('~')) return `パス ${path} は ~ で始まります`;
  if (path.split('/').includes('..')) return `パス ${path} は .. を含みます(リポジトリの根の外へ出られる)`;
  return null;
}
