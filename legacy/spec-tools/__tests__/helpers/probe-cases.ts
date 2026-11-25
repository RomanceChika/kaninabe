/**
 * `probe` の許可表の判定表(検証器 `probe-policy` と実行器の写し `probe-guard` の両方のテストが同じ表を使う)。
 */

export const ARGV_ACCEPTED: ReadonlyArray<readonly string[]> = [
  ['gh', 'secret', 'list', '--json', 'name'],
  ['vercel', 'env', 'ls', 'production'],
  ['vercel', 'env', 'ls', 'preview'],
  ['supabase', 'secrets', 'list'],
  ['supabase', 'secrets', 'list', '--project-ref', 'abcdefghijklmnopqrst'],
];

export const ARGV_REFUSED: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['空', []],
  ['sh -c', ['sh', '-c', 'touch PROBE_MARKER; echo vercel']],
  ['bash -c', ['bash', '-c', 'id']],
  ['node -e', ['node', '-e', 'process.exit(0)']],
  ['絶対パスの実行ファイル', ['/bin/sh', '-c', 'id']],
  ['相対パスの実行ファイル', ['./gh', 'secret', 'list', '--json', 'name']],
  ['../ の実行ファイル', ['../gh', 'secret', 'list', '--json', 'name']],
  ['未知のコマンド', ['curl', 'https://example.com']],
  ['未知のサブコマンド', ['gh', 'api', '/user']],
  ['gh secret set(書き込み)', ['gh', 'secret', 'set', 'X']],
  ['gh の引数の追加', ['gh', 'secret', 'list', '--json', 'name', '--repo', 'a/b']],
  ['gh の引数の不足', ['gh', 'secret', 'list']],
  // 4 回目 C4-3 / C4-9: npx は版を固定しても書けない(cwd の node_modules / .npmrc を拾う・任意の完全な版を通していた)。
  ['版を固定した npx(C4-3)', ['npx', 'vercel@63.1.2', 'env', 'ls', 'production']],
  ['古い完全な版の npx(C4-9)', ['npx', 'vercel@0.0.1', 'env', 'ls', 'production']],
  ['版を固定しない npx', ['npx', 'vercel', 'env', 'ls', 'production']],
  ['dist-tag の npx', ['npx', 'vercel@latest', 'env', 'ls', 'production']],
  ['範囲の npx', ['npx', 'vercel@^63', 'env', 'ls', 'production']],
  ['部分の版の npx', ['npx', 'vercel@63.1', 'env', 'ls', 'production']],
  ['別パッケージの npx', ['npx', 'evil@1.0.0', 'env', 'ls', 'production']],
  ['npx のフラグ', ['npx', '-y', 'vercel@63.1.2', 'env', 'ls', 'production']],
  ['npx --package', ['npx', '--package=evil', 'vercel@63.1.2', 'env', 'ls', 'production']],
  ['vercel の別サブコマンド', ['vercel', 'env', 'pull', 'production']],
  ['vercel の環境名にフラグ', ['vercel', 'env', 'ls', '--token=x']],
  ['vercel の環境名にパス', ['vercel', 'env', 'ls', '../x']],
  ['vercel の環境名が大文字', ['vercel', 'env', 'ls', 'Production']],
  ['supabase の別サブコマンド', ['supabase', 'secrets', 'set']],
  ['supabase のプロジェクト参照が不正', ['supabase', 'secrets', 'list', '--project-ref', '$(id)']],
  ['語の中に空白(1 語に畳んだ文字列)', ['gh secret list --json name']],
  ['大文字小文字違い', ['GH', 'secret', 'list', '--json', 'name']],
];

/** `cwd` の閉じた表(4 回目 C4-3)。 */
export const CWD_ACCEPTED: readonly string[] = ['.', 'app'];

export const CWD_REFUSED: ReadonlyArray<readonly [string, string]> = [
  ['仕様の束の下(植えた node_modules / .npmrc を拾う位置)', 'docs/specs/x'],
  ['根の中の任意の場所', 'sub'],
  ['app の下', 'app/sub'],
  ['./ の表記ゆれ', './app'],
  ['末尾の /', 'app/'],
  ['大文字', 'App'],
  ['空', ''],
  ['..', '..'],
];

export const PATHS_ACCEPTED: readonly string[] = ['.', 'sub', 'sub/.env.local', './sub', 'a/b/c', '.github/workflows', '..foo/x'];

export const PATHS_REFUSED: ReadonlyArray<readonly [string, string]> = [
  ['空', ''],
  ['..', '..'],
  ['../..', '../..'],
  ['途中の ..', 'sub/../../x'],
  ['末尾の ..', 'sub/..'],
  ['絶対パス', '/etc/passwd'],
  ['ドライブ名', 'C:/x'],
  ['~', '~/x'],
  ['バックスラッシュ', 'sub\\..\\..\\x'],
  ['NUL', 'sub\0/x'],
];
