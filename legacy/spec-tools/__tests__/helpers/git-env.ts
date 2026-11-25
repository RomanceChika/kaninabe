/**
 * **テストが本物の git を起こす口の、ただ 1 つの持ち主**(fix22 part 3。点検 22 回目の後の事故の再発の止め)。
 *
 * git は「いま居るリポジトリ」を環境変数でも決める(`GIT_DIR` / `GIT_INDEX_FILE` / `GIT_WORK_TREE` …)。pre-commit フックの中では
 * git がこれらを export しているので、親の環境をそのまま継いだ使い捨てのリポジトリ向けの `git init` / `add` / `commit` / `checkout` が
 * **本物のリポジトリに当たる**(11-07 の事故: 試験が作業木の枝と索引を書き換え、共有の設定に `core.bare = true` を書いた)。
 * 以前の口は外す変数を 7 つの表で持ち、表の外の変数は継いでいた。
 *
 * ここは次の全部を 1 か所で持つ:
 * - 子の環境から `GIT_` で始まる変数を**全部**外す(`withoutGitEnv`。表を持たない)。
 * - 使い捨ての置き場に向けるときは、**リポジトリを置き場に固定する**(`isolatedGitEnv` が `GIT_DIR=<置き場>/.git`・`GIT_WORK_TREE=<置き場>` を置く。
 *   点検 24 回目 C24-1)。以前は `GIT_CEILING_DIRECTORIES` だけで、天井は「上へ探す」のを止めるだけなので、`cwd` を書き忘れた子の git は
 *   作業ディレクトリ(vitest では本物のリポジトリの中)の `.git` を見つけた。天井は二重の守りとして残す。`clone` は `GIT_WORK_TREE` があると断るので、作る間だけ外す。
 * - git とシェルを起こすのはこの口の `spawnIsolatedGit` / `isolatedGit` / `spawnIsolatedShell` / `startIsolatedShell` だけで、作業ディレクトリも置き場に固定する
 *   (git には引数でも `--git-dir` / `--work-tree` を置く。node の子は `spawnIsolatedNode`。点検 25 回目 C25-1)
 *   (テストの側の直の git とシェルは、`env` が口の戻り値でも閉世界の赤。`dev-repo/unit/model/config/test-spawn-env.ts`)。
 * - 置き場が開発用リポジトリの木の中なら、書き込みうる git の命令とシェルを起こさない(読み取りの git だけ通す)。
 * - git を起こすときは(`spawnIsolatedGit` / `isolatedGit`)、書き込みうる命令の前に `git rev-parse --git-dir` / `--git-common-dir` が
 *   置き場の中を指すことを確かめ、外を指せば**起こさずに断る**。リポジトリを付け替える大域の指定(`-C` / `--git-dir` / `--work-tree` …)も断る。
 *
 * - 書き込みの**行き先**も閉じる(点検 23 回目 C23-3・24 回目 C24-2): 引数の読み(`readGitArgs`)は子を起こさない閉じた表で、断るべき引数は子を起こさずに試せる。
 *   利用者の大域の設定は子に効かせない(`GIT_CONFIG_GLOBAL=/dev/null`・`GIT_CONFIG_NOSYSTEM=1`)。
 *
 * `GIT_` を外す本体は実行時パッケージのテストの基盤 `@kaninabe/runtime/testing/git/without-git-env`(このファイルは走り手の根の閉包に入るので、
 * 相対の指定子で読む = 根の import の閉世界 G1。全部の vitest の設定の setupFiles の先頭と、
 * pre-commit の段を包む道具も同じ 1 本を呼ぶ)で、ここは呼ぶだけ。テストの側で子を起こす呼び出しは全部、環境をこの口で作る
 * (`dev-repo/unit/model/config/test-git-guard.test.ts` の閉世界が見る)。開発用リポジトリだけの道具の木のテストは、その木が spec-tools の木から借りる部品の 1 つの入口を
 * 通してここを読む —— spec-tools の木は配布され道具の木は配布されないので、本体を道具の木に置くと spec-tools のテストが import できず
 * 写しが要る。逆向き(道具の木が spec-tools の木を読む)は既にある入口で、写しを持たずに済む。製品の木のテストは境界の外で import
 * できない(読み取りだけの 1 か所が閉じた表の免除に載る)。置き場の名前は配布の約束の文書(public-distribution.md §11)に書く。
 */

import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns, type StdioOptions } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inheritedGitKeys, withoutGitEnv } from '../../../../framework/runtime/testing/git/without-git-env.mts';

export { inheritedGitKeys, withoutGitEnv };

/** 呼び手が足してよい `GIT_` の変数(作者だけ。リポジトリを決める変数は足させない)。 */
const ALLOWED_EXTRA_GIT_KEY = /^GIT_(?:(?:AUTHOR|COMMITTER)_(?:NAME|EMAIL|DATE)|TERMINAL_PROMPT)$/;

/** 利用者の大域の設定を切り離す変数(既定で置く。足すなら同じ値だけ)。 */
const DETACHED_CONFIG: Readonly<Record<string, string>> = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

// ---- 引数の読み(子を起こさない閉じた表。点検 23 回目 C23-3・24 回目 C24-2) ----
//
// git の `config` / `init` / `clone` は parse-options で引数を読む: 長い指定の一意な前置きの略記(`--fil=` = `--file=`・`--syst` = `--system`)と、
// 短い指定の詰めた値(`-f<パス>`・`-bmain`・`-c<鍵>=<値>`)を受ける。字面の正規表現の表はこの 2 つを通した(C24-2)。ここは向きを逆にし、
// 3 つの命令の指定は閉じた表の完全一致だけを許して、表の外(略記・詰めた値・知らない指定)は全部断る。大域の指定(命令の前)は git の本体が
// 完全一致で読む(略記を受けない)ので、表の外を断る `commandIndex` の読みのままでよい。この口は素の node から(道具の木の入口を通して)も読まれるので、
// 相対の import は拡張子まで書いた 1 本だけにする(型の除去は `./x.js` の綴りを隣の `.ts` へ向け直さない)。

/** リポジトリを付け替える大域の指定(断る)。 */
const REDIRECTING_OPTION = /^(?:-C|--git-dir|--work-tree|--namespace|--bare|--super-prefix|--exec-path)(?:=|$)/;

/** `-c` と `config` で書いてよい鍵(閉じた表。外へ書く・外の命令を起こす鍵 —— `core.worktree` / `include.*` / `core.fsmonitor` / 差分の駆動 … —— は表の外)。 */
const CONFIG_KEY = /^(?:user\.(?:name|email)|(?:commit|tag)\.gpgsign|core\.(?:bare|autocrlf|quotepath|filemode|ignorecase|precomposeunicode|safecrlf)|init\.defaultbranch|advice\.[\w-]+|color\.ui|merge\.(?:ff|conflictstyle)|pull\.rebase|gc\.auto)$/i;

/**
 * 命令の指定の閉じた表(`flags` は値を取らない・`values` は値を 1 つ取る。長い指定の値は `=` でも次の引数でもよい。
 * `attached` は値を詰めて書いてよい短い指定(`-S<文字列>` など。行き先のパスを取る指定は載せない)。
 * 束ねた短い指定(`-qm`)は、全部が `flags` の短い指定で、最後の 1 つだけが `values` の指定(値は次の引数)のときだけ読む(parse-options と同じ読み方の部分集合)。
 */
interface OptionTable {
  readonly flags: ReadonlySet<string>;
  readonly values: ReadonlySet<string>;
  readonly attached?: ReadonlySet<string>;
}

/** 表を作る(`flags` / `values` / `attached` を空白区切りの字面で書く)。 */
const optionTable = (flags: string, values = '', attached = ''): OptionTable => {
  const split = (text: string): ReadonlySet<string> => new Set(text.split(' ').filter((word) => word !== ''));
  return { flags: split(flags), values: split(values), attached: split(attached) };
};

/**
 * **命令ごとの指定の閉じた表**(点検 25 回目 C25-2。否定の正規表現 `OUTWARD_OPTION` をやめた)。命令は 2 つの種類に分かれる:
 * `read` は読み取りだけの命令(書き込みの前の確かめを要らない)、`write` は置き場の中(git dir と作業木)だけに書く命令。表の外の命令は起こさない
 * (`push` / `fetch` / `worktree` / `submodule` / `archive` / `bundle` / `format-patch` …)。各命令の表の外の指定(`-` で始まる引数)は全部断る —— 略記(`--open=`)・
 * 束ねた指定(`-iO<命令>`)・外へ書く指定(`--output` / `--open-files-in-pager` / `-O`)・置き場の外へ書く指定(`apply --unsafe-paths` / `--directory`)・
 * 外の命令を起こす指定(`merge -s` / `--strategy`。PATH の `git-merge-<名前>` を起こす)は表に載せない。表はテストが使う指定(11-08 に全部の試験を回して集めた)と、その同義の綴りだけ。
 */
const COMMAND_OPTIONS: Readonly<Record<string, { readonly kind: 'read' | 'write' } & OptionTable>> = {
  'rev-parse': { kind: 'read', ...optionTable('--git-dir --git-common-dir --show-toplevel --abbrev-ref --verify -q --quiet --is-inside-work-tree --short --symbolic-full-name', '--path-format') },
  'ls-files': { kind: 'read', ...optionTable('-z --cached -c --others -o --exclude-standard --deleted --modified -s --stage') },
  'ls-tree': { kind: 'read', ...optionTable('-r -z -t --name-only') },
  // 費用の台帳の spec_changed の照らし(開発用リポジトリの台帳の道具)が読む差分の指定(点検 fix26 D26-5。読み取りだけ・外へ書かない)。
  log: { kind: 'read', ...optionTable('--no-merges --name-only --name-status --oneline --reverse --first-parent -z --all --no-walk=unsorted --ignore-missing --diff-merges=first-parent -p -U1000000 --no-color --no-ext-diff --no-renames', '--format --pretty -n --max-count -S', '-S -n') },
  show: { kind: 'read', ...optionTable('--name-only --name-status --stat -s --no-patch', '--format --pretty') },
  diff: { kind: 'read', ...optionTable('--cached --staged --name-only --name-status -M -z --stat --quiet --exit-code --no-renames', '--diff-filter') },
  'diff-tree': { kind: 'read', ...optionTable('-r -z -M --root --no-commit-id --name-only --name-status') },
  'cat-file': { kind: 'read', ...optionTable('-e -t -p -s') },
  'merge-base': { kind: 'read', ...optionTable('--is-ancestor --all') },
  'rev-list': { kind: 'read', ...optionTable('--count --merges --no-merges --all --reverse --first-parent --no-walk=unsorted --ignore-missing', '--max-count -n', '-n') },
  'show-ref': { kind: 'read', ...optionTable('--verify -q --quiet --heads --tags -s --hash') },
  'for-each-ref': { kind: 'read', ...optionTable('', '--format --sort --count') },
  status: { kind: 'read', ...optionTable('--porcelain -s --short -z -b --branch', '--porcelain --untracked-files') },
  describe: { kind: 'read', ...optionTable('--tags --always', '--abbrev') },
  grep: { kind: 'read', ...optionTable('-n -l -i -I -q --quiet -z -w -F -E --cached --untracked', '-e') },
  blame: { kind: 'read', ...optionTable('--porcelain -s', '-L') },
  'name-rev': { kind: 'read', ...optionTable('--name-only') },
  version: { kind: 'read', ...optionTable('') },
  init: { kind: 'write', ...optionTable('') },
  clone: { kind: 'write', ...optionTable('') },
  config: { kind: 'write', ...optionTable('') },
  add: { kind: 'write', ...optionTable('-A --all -u --update -N --intent-to-add -q --quiet -f --force') },
  commit: { kind: 'write', ...optionTable('-q --quiet --allow-empty -a --all', '-m --message') },
  checkout: { kind: 'write', ...optionTable('-q --quiet', '-b') },
  switch: { kind: 'write', ...optionTable('-q --quiet', '-c --create --orphan') },
  branch: { kind: 'write', ...optionTable('-q --quiet -d -D') },
  tag: { kind: 'write', ...optionTable('-a -f', '-m --message') },
  mv: { kind: 'write', ...optionTable('-f') },
  rm: { kind: 'write', ...optionTable('-q --quiet -r -f --cached') },
  reset: { kind: 'write', ...optionTable('-q --quiet --hard --soft --mixed') },
  restore: { kind: 'write', ...optionTable('-q --staged --worktree', '-s --source') },
  merge: { kind: 'write', ...optionTable('--no-ff --ff-only -q --quiet --no-edit', '-m --message') },
  'update-ref': { kind: 'write', ...optionTable('-d', '-m') },
  'symbolic-ref': { kind: 'write', ...optionTable('-q', '-m') },
  stash: { kind: 'write', ...optionTable('-q --quiet') },
  'cherry-pick': { kind: 'write', ...optionTable('--no-edit -n --no-commit') },
  revert: { kind: 'write', ...optionTable('--no-edit -n --no-commit') },
  'read-tree': { kind: 'write', ...optionTable('--empty') },
  'update-index': { kind: 'write', ...optionTable('--add --remove --refresh -q', '--cacheinfo') },
  'write-tree': { kind: 'write', ...optionTable('') },
  'commit-tree': { kind: 'write', ...optionTable('', '-m -p') },
  'hash-object': { kind: 'write', ...optionTable('-w --stdin') },
  apply: { kind: 'write', ...optionTable('--cached --index --check -R --reverse') },
  notes: { kind: 'write', ...optionTable('') },
};



/** `config` の指定(行き先を名指す `--global` / `--system` / `--file` / `-f` / `--blob` と `--edit` は表の外)。 */
const CONFIG_OPTIONS: OptionTable = {
  flags: new Set(['--local', '--worktree', '--get', '--get-all', '--get-regexp', '--list', '-l', '--unset', '--unset-all', '--add', '--replace-all', '--bool', '--int', '--null', '-z', '--name-only', '--show-origin', '--show-scope']),
  values: new Set(),
};

/** `config` の読み取りの指定。 */
const CONFIG_READ_FLAGS: ReadonlySet<string> = new Set(['--get', '--get-all', '--get-regexp', '--list', '-l']);

/** 置き場そのものにリポジトリを作る命令の指定と、位置引数の数(`init` は場所の引数なし・`clone` は元と `.` だけ)。 */
const CREATING_COMMANDS: Readonly<Record<string, OptionTable & { readonly positionals: number }>> = {
  init: { flags: new Set(['-q', '--quiet']), values: new Set(['-b', '--initial-branch']), positionals: 0 },
  clone: { flags: new Set(['-q', '--quiet', '--single-branch', '--no-tags']), values: new Set(['-b', '--branch', '--depth']), positionals: 2 },
};

/**
 * 命令の後ろの引数を閉じた表で読み、位置引数を返す(表の外の指定・略記・詰めた値は例外)。
 *
 * @param command 命令
 * @param rest 命令の後ろの引数
 * @param table 指定の表
 * @returns 位置引数
 */
function readOptions(command: string, rest: readonly string[], table: OptionTable): readonly string[] {
  const positionals: string[] = [];
  let ended = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] ?? '';
    if (ended || !arg.startsWith('-') || arg === '-') {
      positionals.push(arg);
      continue;
    }
    if (arg === '--') {
      ended = true;
      continue;
    }
    if (table.flags.has(arg)) continue;
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    if (table.values.has(eq < 0 ? arg : arg.slice(0, eq))) {
      if (eq < 0) index += 1;
      if (index >= rest.length) throw new Error(`隔離した git の ${command} の ${arg} に値がありません`);
      continue;
    }
    if (!arg.startsWith('--') && table.attached?.has(arg.slice(0, 2)) === true && arg.length > 2) continue;
    const bundle = !arg.startsWith('--') && arg.length > 2 ? [...arg.slice(1)].map((letter) => `-${letter}`) : [];
    const last = bundle.at(-1) ?? '';
    if (bundle.length > 0 && bundle.slice(0, -1).every((flag) => table.flags.has(flag)) && (table.flags.has(last) || table.values.has(last))) {
      if (table.values.has(last)) index += 1;
      if (index >= rest.length) throw new Error(`隔離した git の ${command} の ${arg} に値がありません`);
      continue;
    }
    throw new Error(`隔離した git の ${command} で ${arg} は使えません(指定は閉じた表の完全一致だけ。略記・詰めた値・表の外の指定は断る)`);
  }
  return positionals;
}

/**
 * 値(置き場からの相対か絶対のパス)が置き場の中を指すか。
 *
 * @param dir 置き場
 * @param value パス
 */
function insidePlace(dir: string, value: string): boolean {
  const root = realpathSync(dir);
  const where = path.resolve(root, value);
  return where === root || where.startsWith(`${root}${path.sep}`);
}

/**
 * `-c` と `config` の鍵が表にあるか(`core.hooksPath` はフックを止める `/dev/null` か、置き場の中のフックの置き場だけ)。
 *
 * @param dir 置き場
 * @param key 鍵
 * @param value 値(書かないなら undefined)
 */
function checkConfigKey(dir: string, key: string, value: string | undefined): void {
  if (/^core\.hookspath$/i.test(key) && value !== undefined && (value === '/dev/null' || insidePlace(dir, value))) return;
  if (!CONFIG_KEY.test(key)) throw new Error(`隔離した git では設定の鍵 ${key} を書けません(外へ書く・外の命令を起こす鍵を表で閉じる)`);
}

/**
 * `config` の引数が置き場の中だけに書くか(指定を閉じた表で読み、書く鍵を表で見る)。
 * 読み取りは、読み取りの指定(`--get*` / `--list` / `-l`)か、1 つ目の位置引数が新しい書き方の `get` / `list` のときだけ(値の位置の `get` は読み取りでない)。
 *
 * @param dir 置き場
 * @param rest `config` の後ろの引数
 */
function checkConfig(dir: string, rest: readonly string[]): void {
  const positionals = [...readOptions('config', rest, CONFIG_OPTIONS)];
  if (rest.some((arg) => CONFIG_READ_FLAGS.has(arg)) || positionals[0] === 'get' || positionals[0] === 'list') return;
  if (positionals[0] === 'set' || positionals[0] === 'unset') positionals.shift();
  const [key, value] = positionals;
  if (key === undefined) throw new Error('隔離した git の config に鍵がありません(--edit などは起こさない)');
  checkConfigKey(dir, key, value);
}

/** 引数の大域の指定を読み飛ばして、命令の位置を返す(読めない・付け替える指定なら例外。git の本体は大域の指定を完全一致で読む)。 */
function commandIndex(dir: string, args: readonly string[]): number {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '-c') {
      index += 1;
      const pair = args[index] ?? '';
      const at = pair.indexOf('=');
      checkConfigKey(dir, at < 0 ? pair : pair.slice(0, at), at < 0 ? undefined : pair.slice(at + 1));
      continue;
    }
    if (arg === '--no-pager' || arg === '--literal-pathspecs' || arg === '--no-optional-locks') continue;
    if (REDIRECTING_OPTION.test(arg)) throw new Error(`隔離した git ではリポジトリを付け替える指定 ${arg} を使えません`);
    if (arg.startsWith('-')) throw new Error(`隔離した git で読めない大域の指定です: ${arg}`);
    return index;
  }
  throw new Error('隔離した git の引数に命令がありません');
}

/** 作る命令(`init` / `clone`)の引数が置き場の外に作らないか(指定を閉じた表で読み、置き場そのもの以外の行き先を断る)。 */
function checkCreating(command: string, rest: readonly string[]): void {
  const shape = CREATING_COMMANDS[command];
  if (shape === undefined) return;
  const positionals = readOptions(command, rest, shape);
  const placeOk = command === 'init' ? positionals.length === 0 : positionals.length === shape.positionals && positionals.at(-1) === '.';
  if (!placeOk) throw new Error(`隔離した git の ${command} は置き場そのものに作ります(引数 ${positionals.join(' ')} は使えません)`);
}

/** 引数の読みの結果。 */
interface GitArgsShape {
  /** 命令。 */
  readonly command: string;
  /** 置き場そのものにリポジトリを作る命令(`init` / `clone`)か。 */
  readonly creating: boolean;
  /** 書き込みうるか(読み取りの命令の表の外)。 */
  readonly writes: boolean;
}

/**
 * 置き場 `dir` で `args` を起こしてよいかを読む(子を起こさない。断るなら例外)。
 *
 * @param dir 置き場
 * @param args git の引数
 * @returns 命令の形
 */
function readGitArgs(dir: string, args: readonly string[]): GitArgsShape {
  const at = commandIndex(dir, args);
  const command = args[at] ?? '';
  const rest = args.slice(at + 1);
  const shape = Object.hasOwn(COMMAND_OPTIONS, command) ? COMMAND_OPTIONS[command] : undefined;
  if (shape === undefined) throw new Error(`隔離した git では命令 ${command} を起こしません(読み取りと置き場の中だけに書く命令の表の外)`);
  if (command === 'config') checkConfig(dir, rest);
  else if (Object.hasOwn(CREATING_COMMANDS, command)) checkCreating(command, rest);
  else readOptions(command, rest, shape);
  return { command, creating: Object.hasOwn(CREATING_COMMANDS, command), writes: shape.kind === 'write' };
}

/** このファイルの木の根(開発用リポジトリ。置き場がこの中なら書き込みうる命令とシェルを起こさない)。 */
const TREE_ROOT = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));

/** `dir` が開発用リポジトリの木の中か。 */
function insideTree(dir: string): boolean {
  const at = realpathSync(dir);
  return at === TREE_ROOT || at.startsWith(`${TREE_ROOT}${path.sep}`);
}

/**
 * 使い捨ての置き場 `dir` に向けた git の環境(`GIT_` を全部外し、リポジトリを置き場に固定し、置き場の上を探させない)。
 * **子の連鎖が `GIT_` を外さない限り**、子の作業ディレクトリがどこでも子の git は `<置き場>/.git` と置き場の作業木を指す(`.git` が gitfile なら git がその先を読む)。
 * 途中に `GIT_` を外す子(pre-commit の段の道具・フックの段)があると固定も天井も消え、作業ディレクトリだけが残る(点検 25 回目 C25-1)。
 * だから子の作業ディレクトリも置き場にする(テストの側の呼び出しは `cwd` を同じ置き場の式にすることを閉世界が求める。口の `spawnIsolated*` は自分で置く)。
 *
 * @param dir 使い捨ての置き場(在ること)
 * @param extra 足す変数(`GIT_` の変数は作者と設定の切り離しだけ。ほかは断る)
 * @param base 元の環境(既定は `process.env`)
 * @returns 子の `env` にそのまま渡せる環境
 */
export function isolatedGitEnv(dir: string, extra: Readonly<Record<string, string>> = {}, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  for (const key of Object.keys(extra)) {
    const detached = DETACHED_CONFIG[key];
    if (detached !== undefined ? extra[key] !== detached : key.startsWith('GIT_') && !ALLOWED_EXTRA_GIT_KEY.test(key)) throw new Error(`隔離した git の環境に ${key} は足せません(リポジトリを決める変数・大域の設定の行き先を子に渡さない)`);
  }
  const root = realpathSync(dir);
  return { ...withoutGitEnv(base), ...extra, ...DETACHED_CONFIG, GIT_DIR: path.join(root, '.git'), GIT_WORK_TREE: root, GIT_CEILING_DIRECTORIES: path.dirname(root), GIT_OPTIONAL_LOCKS: '0' };
}

/**
 * 口が git の引数の頭に置く固定(点検 25 回目 C25-1 (b))。環境の `GIT_DIR` / `GIT_WORK_TREE` は子の連鎖の途中で外されうる(git が起こすフック・別名・
 * ページャの先の道具が `GIT_` を外す)ので、引数でも同じ置き場を名指す。`clone` は `--git-dir` / `--work-tree` と組めない(作る先は位置引数の `.`)ので `-C <置き場>` にする。
 * `init` は `--git-dir=<置き場>/.git --work-tree=<置き場>` でも `core.worktree` を書かない(作業木が git dir の親なので。11-08 の実測)。
 * 呼び手の引数の `-C` / `--git-dir` / `--work-tree` は引数の読みが断る(口だけが置く)。
 *
 * @param root 置き場の実体
 * @param command 命令
 * @returns 頭に置く引数
 */
export function isolatedGitPinArgs(root: string, command: string): readonly string[] {
  return command === 'clone' ? ['-C', root] : [`--git-dir=${path.join(root, '.git')}`, `--work-tree=${root}`];
}

/** 置き場の git dir の在りか。 */
export type GitDirPlace = { readonly kind: 'inside' } | { readonly kind: 'none' } | { readonly kind: 'outside'; readonly where: string };

/**
 * `dir` の git dir(と共有の git dir)が `dir` の中を指すか。
 *
 * @param dir 置き場
 * @param env 起こす環境
 * @returns 中 / リポジトリでない / 外(外ならその場所)
 */
export function gitDirPlace(dir: string, env: NodeJS.ProcessEnv): GitDirPlace {
  const root = realpathSync(dir);
  const result = spawnSync('git', [...isolatedGitPinArgs(root, 'rev-parse'), 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], { cwd: root, env, encoding: 'utf-8' });
  if (result.status !== 0) {
    if (/not a git repository/i.test(result.stderr)) return { kind: 'none' };
    throw new Error(`git dir を確かめられません(${dir}): ${result.stderr || String(result.error)}`);
  }
  for (const line of result.stdout.split('\n').filter((entry) => entry !== '')) {
    const where = existsSync(line) ? realpathSync(line) : line;
    if (where !== root && !where.startsWith(`${root}${path.sep}`)) return { kind: 'outside', where };
  }
  return { kind: 'inside' };
}

/**
 * 置き場 `dir` で `args` を起こしてよいかを確かめる(子を起こさない。断るなら例外。引数の読みと、置き場が開発用リポジトリの木の中か)。
 *
 * @param dir 置き場
 * @param args git の引数
 * @returns 命令の形
 */
export function checkIsolatedGitArgs(dir: string, args: readonly string[]): GitArgsShape {
  const shape = readGitArgs(dir, args);
  if (shape.writes && insideTree(dir)) throw new Error(`隔離した git: 置き場 ${dir} が開発用リポジトリの木の中なので、書き込みうる命令 ${shape.command} を起こしません`);
  return shape;
}

/** 設定の値 1 つの出どころ。 */
export interface GitConfigOrigin {
  /** `system` / `global` / `local` / `worktree` / `command`。 */
  readonly scope: string;
  /** 出どころのファイル(`file:` の後ろ。ファイルでなければ出どころの字面のまま)。 */
  readonly file: string;
}

/**
 * 利用者の本物の設定(system と大域)が、どのファイルから読まれているか(読み取りだけ。最後の線の候補の表の閉世界の突合に使う。点検 25 回目 C25-1)。
 * 範囲を名指す指定(`--system` / `--global` / `--file`)は子に渡さない(11-07 の事故の後の約束)。範囲は `--show-scope` で読む。
 * 置き場はリポジトリでない場所にする(local の設定を混ぜない)。環境は `GIT_` を全部外したもの(切り離しの `GIT_CONFIG_NOSYSTEM` も置かない = 本物の設定を読む)。
 *
 * @param dir リポジトリでない置き場
 * @returns 出どころの並び(重なりなし)
 */
export function gitConfigOrigins(dir: string): readonly GitConfigOrigin[] {
  const root = realpathSync(dir);
  const result = spawnSync('git', ['config', '--list', '--show-origin', '--show-scope', '-z'], { cwd: root, env: { ...withoutGitEnv(), GIT_CEILING_DIRECTORIES: path.dirname(root) }, encoding: 'utf-8' });
  if (result.status !== 0 && result.stdout === '') return [];
  const seen = new Map<string, GitConfigOrigin>();
  const fields = result.stdout.split('\0');
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const [scope = '', origin = ''] = [fields[index], fields[index + 1]];
    const file = origin.startsWith('file:') ? path.resolve(root, origin.slice('file:'.length)) : origin;
    seen.set(`${scope}\0${file}`, { scope, file });
  }
  return [...seen.values()];
}

/** 起こし方の指定。 */
export interface IsolatedGitOptions {
  /** 足す変数(`isolatedGitEnv` の `extra`)。 */
  readonly extraEnv?: Readonly<Record<string, string>>;
  /** 標準入力に渡す文字列。 */
  readonly input?: string;
  /** 出力の上限(既定 256 MiB)。 */
  readonly maxBuffer?: number;
}

/**
 * 置き場 `dir` で git を起こす(`GIT_` を全部外し、書き込みうる命令は git dir が置き場の中を指すときだけ。外なら起こさずに例外)。
 * 終了コードは見ない(失敗を確かめる呼び手のため)。失敗を例外にするなら `isolatedGit`。
 *
 * @param dir 置き場(作業ディレクトリにもなる)
 * @param args git の引数
 * @param options 起こし方
 * @returns 子の結果
 */
export function spawnIsolatedGit(dir: string, args: readonly string[], options: IsolatedGitOptions = {}): SpawnSyncReturns<string> {
  const pinned = isolatedGitEnv(dir, options.extraEnv);
  const { command, creating, writes } = checkIsolatedGitArgs(dir, args);
  // `git clone` は `GIT_WORK_TREE` があると「作業木が既にある」で断る。作る間だけ外す(行き先は位置引数の `.` = 作業ディレクトリの置き場で、後で確かめる)。
  const env = command === 'clone' ? { ...pinned, GIT_WORK_TREE: undefined } : pinned;
  if (writes) {
    const place = gitDirPlace(dir, pinned);
    if (place.kind === 'outside') throw new Error(`隔離した git: ${dir} の git dir が置き場の外(${place.where})を指すので、書き込みうる命令 ${command} を起こしません`);
    if (place.kind === 'none' && !creating) throw new Error(`隔離した git: ${dir} はリポジトリではありません(${command} を起こしません)`);
  }
  const root = realpathSync(dir);
  const result = spawnSync('git', [...isolatedGitPinArgs(root, command), ...args], { cwd: root, env, encoding: 'utf-8', input: options.input, maxBuffer: options.maxBuffer ?? 256 * 1024 * 1024 });
  if (creating && result.status === 0) {
    const place = gitDirPlace(dir, pinned);
    if (place.kind !== 'inside') throw new Error(`隔離した git: ${command} の後の git dir が置き場の中にありません(${place.kind === 'outside' ? place.where : 'なし'})`);
  }
  return result;
}

/**
 * `spawnIsolatedGit` で起こし、失敗なら例外(標準エラーつき)。
 *
 * @param dir 置き場
 * @param args git の引数
 * @param options 起こし方
 * @returns 標準出力
 */
export function isolatedGit(dir: string, args: readonly string[], options: IsolatedGitOptions = {}): string {
  const result = spawnIsolatedGit(dir, args, options);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} が失敗しました(${String(result.status)}): ${result.stderr || String(result.error)}`);
  return result.stdout;
}

/** シェルの起こし方。 */
export interface IsolatedShellOptions {
  /** シェル(既定は `/bin/sh`)。 */
  readonly shell?: '/bin/sh' | 'sh' | 'bash';
  /** 足す変数(`isolatedGitEnv` の `extra`)。 */
  readonly extraEnv?: Readonly<Record<string, string>>;
  /** 元の環境(`isolatedGitEnv` の `base`。既定は `process.env`)。 */
  readonly baseEnv?: NodeJS.ProcessEnv;
  /** 標準入力に渡す文字列(同期だけ)。 */
  readonly input?: string;
  /** 時間の上限(ミリ秒。同期だけ)。 */
  readonly timeout?: number;
}

/**
 * シェルと node の子の起こし方の共通(置き場が開発用リポジトリの木の中なら断る)。
 *
 * **シェルと node の子の固定は作業ディレクトリと環境の 2 つ**(点検 25 回目 C25-1 (b))。台本や道具の中の git の引数は口が書けない(台本を読まない)ので、
 * git の引数の固定(`isolatedGitPinArgs`)は使えない。代わりに作業ディレクトリを置き場の実体にする —— 台本の途中の段が `GIT_` を外しても、git は作業ディレクトリから
 * 上へ探して置き場の `.git` を見つける(置き場がリポジトリでなければ、置き場の上 = 開発用リポジトリの木の外の一時ディレクトリを探し、本物には当たらない)。
 * 台本が自分で `cd` して別の場所の git を起こすのは試験の対象の台本の側の誤りで、最後の線(本物の git の状態の前後比較。開発用リポジトリの道具で、配布の木には無い)が名指す。
 */
function shellLaunch(dir: string, options: IsolatedShellOptions, what = '隔離したシェル'): { readonly shell: string; readonly env: NodeJS.ProcessEnv; readonly cwd: string } {
  if (insideTree(dir)) throw new Error(`${what}: 置き場 ${dir} が開発用リポジトリの木の中なので起こしません(台本の git が当たる先を置き場に固定できない)`);
  return { shell: options.shell ?? '/bin/sh', env: isolatedGitEnv(dir, options.extraEnv, options.baseEnv), cwd: realpathSync(dir) };
}

/**
 * 置き場 `dir` でシェルを起こす(フックや CI の判定の台本を本物のシェルで回すテストの口)。作業ディレクトリは置き場、環境は `isolatedGitEnv(dir)` で、
 * 台本の中の git は置き場のリポジトリに固定される(置き場がリポジトリでなければ git は「リポジトリでない」で失敗する)。台本の命令は読まない
 * —— 台本が自分で `GIT_DIR` を外して別の場所へ行くのは試験の対象の台本の側の誤りで、置き場をリポジトリの外に置くことが最後の守りになる。
 *
 * @param dir 置き場(開発用リポジトリの木の外)
 * @param args シェルの引数(`['-c', 台本]` か台本のファイル)
 * @param options 起こし方
 * @returns 子の結果
 */
export function spawnIsolatedShell(dir: string, args: readonly string[], options: IsolatedShellOptions = {}): SpawnSyncReturns<string> {
  const { shell, env, cwd } = shellLaunch(dir, options);
  return spawnSync(shell, [...args], { cwd, env, encoding: 'utf-8', input: options.input, timeout: options.timeout, maxBuffer: 256 * 1024 * 1024 });
}

/**
 * 置き場 `dir` で node の子を起こす(段の道具・CLI の台本を、作業ディレクトリと環境を置き場に固定して回す口。点検 25 回目 C25-1)。
 * 子が `GIT_` を外す道具(開発用リポジトリの走り手の段の包みなど)でも、孫の git は作業ディレクトリ = 置き場から探す。
 *
 * @param dir 置き場(開発用リポジトリの木の外)
 * @param args node の引数(台本と、その引数)
 * @param options 起こし方(`shell` は使わない)
 * @returns 子の結果
 */
export function spawnIsolatedNode(dir: string, args: readonly string[], options: Omit<IsolatedShellOptions, 'shell'> = {}): SpawnSyncReturns<string> {
  const { env, cwd } = shellLaunch(dir, options, '隔離した node');
  return spawnSync(process.execPath, [...args], { cwd, env, encoding: 'utf-8', input: options.input, timeout: options.timeout, maxBuffer: 256 * 1024 * 1024 });
}

/**
 * `spawnIsolatedShell` の非同期の形(終わりを待たずに子を返す。群の後始末の試験など)。
 *
 * @param dir 置き場(開発用リポジトリの木の外)
 * @param args シェルの引数
 * @param options 起こし方と、子の群と入出力
 * @returns 子
 */
export function startIsolatedShell(dir: string, args: readonly string[], options: IsolatedShellOptions & { readonly detached?: boolean; readonly stdio?: StdioOptions } = {}): ChildProcess {
  const { shell, env, cwd } = shellLaunch(dir, options);
  return spawn(shell, [...args], { cwd, env, detached: options.detached, stdio: options.stdio });
}
