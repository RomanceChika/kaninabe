/**
 * J2(続き)のホストの後段の部分 — **ホストの設定(実装の木の直下の `vercel.json`)の鍵の許可表**(点検 8 回目 C8-1・B8-3・C8-3)。
 *
 * アプリの枠の設定(`next.config.*`)は鍵の許可表で閉じた(7 回目 C7-4・B7-4。`lib/targets/nextjs/layout.ts` の `NEXT_CONFIG_ALLOWED_KEYS`)。
 * ところが Vercel では**同じ欄**(転送・別名の行き先・応答のヘッダ・URL の形)がホストの設定にもあり、Next より前(エッジ)で効く。
 * 製品はこのファイルを Cron の登録(`crons`)のために既に編集するので、ふつうの書き方で欄が足される。ここはその面を許可表で閉じる。
 *
 * | 欄 | 扱い | 理由 |
 * |---|---|---|
 * | `$schema` | 許す(文字列) | 編集の補完のための目印だけ(挙動を変えない) |
 * | `crons` | 許す(要素は `path` / `schedule` の 2 欄の文字列だけ) | Cron の登録。中身の突合は J2 の `j2-schedule-parity.ts`。要素に別の欄を書かせない(突合が読まない欄で挙動を変えさせない) |
 * | `regions` | 許す(文字列の並び) | 関数の置き場(地域)だけ。口も行き先も変えない |
 * | `git` | 許す(値は固定。下の `deploymentEnabled` だけ) | Git 連携の自動デプロイを止める(C8-3)。本番は夜間の出荷の Deploy Hook だけ |
 * | `rewrites` / `redirects` / `routes`(古い形) | 拒む | 要求を別の行き先(外部の URL を含む。要求を cookie ごと外へ中継する)へ流し、クエリを宛先にする開いた転送も書ける。宣言した口と URL の 1 対 1(J2)・前段の matcher の前提が崩れる |
 * | `headers` | 拒む | 前段(`proxy`)の `Cache-Control: no-store` などを上書きしうる。応答のヘッダの正はブラウザ側の守りの宣言の生成物 1 本(B7-4) |
 * | `trailingSlash` / `cleanUrls` | 拒む | URL の形を変え、前段の matcher(`api/` の除外)と J2 の URL の前提が崩れる |
 * | `buildCommand` | 許す(値は固定。`npm run build` だけ) | ビルドの入口の関所(点検 13 回目)を通す。Vercel の文書によれば、この欄は管理画面の Build Command の上書きと `package.json` の `build` より優先される。値を固定するので、ここから別の命令は入らない。`npm run build` の中身は製品のテスト(`app/scripts/build-gate.test.ts`)が見る |
 * | `functions` / `images` / `framework` / `installCommand` / `outputDirectory` / `ignoreCommand` / `devCommand` / `build` / `env` | 拒む | 組み立てと実行の環境を変える(依存の install・ビルドの命令・実行時間と記憶域・環境変数)。本番の環境変数は設定カタログが正(K 群) |
 * | `github` / `public` / それ以外の全部 | 拒む | 表に無い欄は口と出荷の経路を変えうるかを判断していないので、足すときは理由を書いてこの表に載せる |
 *
 * **`git.deploymentEnabled` の形**(C8-3): 値は**オブジェクト**で、全部の値が `false`、`"**"`(minimatch で `/` を含む全ブランチに当たる)を含む。
 * Vercel の文書は「複数の規則に当たり 1 つでも `true` があればデプロイする」と書くので、`true` の行は 1 つでも赤にする。
 * `false`(真偽値 1 つ)の形は採らない —— 本番は Deploy Hook で出しており、`main: false` を入れた状態で Hook が効くことは実測があるが
 * (`config-provisioning.md`)、真偽値の形と Hook の両立は文書でも実測でも確かめていない(非推奨の `github.enabled = false` は Hook を止めると文書にある)。
 * オブジェクトの形なら `main` の評価は今と同じ(`false`)で、Hook の経路は変わらない。
 *
 * **設定の置き場は `vercel.json` の 1 本だけ**(9 回目 C9-3)。Vercel は `vercel.json` のほかに、プログラムで書く設定(`vercel.ts` など)と古い名前の
 * `now.json` も読む。そこに転送・ヘッダを書くと、上の許可表は見ない。実装の木の直下に `vercel.*` / `now.*`(大文字小文字を問わない)で `vercel.json` でない
 * 名前があれば、それ自体を赤にする(lockfile の別の名前を拒むのと同じ形。名前の許可表は `vercel.json` の 1 つ)。
 *
 * 置き場が J2 なのは、アプリの枠の設定の許可表(`j2-entry-outside.ts` の `frameConfig`)と同じく「入口の母集合と URL の前提を変える設定」の見張りだからである。
 * **実装の木があるのに `vercel.json` が無いことも赤**(10 回目 C10-5)。Vercel はプロジェクトの Git 連携があれば、設定の無いリポジトリの push を既定で全部デプロイする。
 * `git.deploymentEnabled` を必須にした理由(無ければ全ブランチが自動デプロイ)はファイルの不在にも効くので、Cron を持たない製品も `git` の宣言だけのファイルを置く
 * (`crons` は書かなくてよい)。実装の木が無いときは見ない(開く欄が無い)。読めない(JSON でない・最上位がオブジェクトでない)ときは赤(ホストが読めるかを判断しない)。
 */

import path from 'node:path';
import { appGrounded, listEntries } from '../../../io/paths.js';
import { tryReadText } from '../../../io/read-text.js';
import type { Finding } from '../../../kernel/finding.js';
import type { JobCheckInput } from '../../../job/target-checks.js';
import { CRON_CONFIG_FILE_NAME, cronConfigFile } from './j2-schedule-parity.js';

/** 最上位に書いてよい欄(上の表の「許す」)。 */
export const HOST_CONFIG_ALLOWED_KEYS: readonly string[] = ['$schema', 'buildCommand', 'crons', 'regions', 'git'];

/** `buildCommand` に書いてよい唯一の値(上の表)。 */
export const HOST_BUILD_COMMAND = 'npm run build';

/** 拒む欄のうち、理由を名指すもの(上の表。表に無い欄は「判断していない」の理由で拒む)。 */
const REJECT_REASONS: Readonly<Record<string, string>> = {
  rewrites: '要求を別の行き先(外部の URL を含む)へ流す',
  redirects: '要求を別の行き先へ流す(クエリを宛先にする開いた転送も書ける)',
  routes: '要求を別の行き先へ流し、ヘッダも足せる(古い形)',
  headers: '前段の Cache-Control: no-store などを上書きしうる(応答のヘッダの正はブラウザ側の守りの宣言)',
  trailingSlash: 'URL の形を変え、前段の matcher と J2 の URL の前提が崩れる',
  cleanUrls: 'URL の形を変え、前段の matcher と J2 の URL の前提が崩れる',
  functions: '関数の実行環境(実行時間・記憶域・同梱するファイル)を変える',
  images: '画像の最適化の口(外の取得元)を開く',
  framework: '組み立ての枠を差し替える',
  installCommand: '依存の install の命令を差し替える',
  outputDirectory: '出力の置き場を差し替える',
  ignoreCommand: 'デプロイの要否の命令を差し替える',
  devCommand: '開発の命令を差し替える',
  build: '組み立ての環境変数を足す',
  env: '実行の環境変数を足す(本番の環境変数の正は設定カタログ)',
};

/** `crons` の要素に書いてよい欄。 */
const CRON_ENTRY_KEYS: readonly string[] = ['path', 'schedule'];

/** `git.deploymentEnabled` に必ず要る、全ブランチに当たる鍵(minimatch。`*` は `/` を含む名前に当たらない)。 */
export const ALL_BRANCHES_GLOB = '**';

/** 素のオブジェクトか(配列・null を除く)。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `git` の欄の値の破れ(C8-3)。守っていれば null。
 *
 * @param value `git` の値
 */
export function gitSectionProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'git はオブジェクトでなければならない';
  const extra = Object.keys(value).filter((key) => key !== 'deploymentEnabled');
  if (extra.length > 0) return `git に許可表の外の欄がある(${extra.join(', ')})。書けるのは deploymentEnabled だけ`;
  const enabled = value['deploymentEnabled'];
  if (!isRecord(enabled)) return 'git.deploymentEnabled はブランチの glob → false のオブジェクトでなければならない(真偽値 1 つの形と Deploy Hook の両立は確かめていない)';
  const notFalse = Object.entries(enabled).filter(([, flag]) => flag !== false).map(([branch]) => branch);
  if (notFalse.length > 0) return `git.deploymentEnabled に false でない行がある(${notFalse.join(', ')})。1 つでも true に当たるブランチは自動でデプロイされる`;
  if (!Object.hasOwn(enabled, ALL_BRANCHES_GLOB)) return `git.deploymentEnabled に "${ALL_BRANCHES_GLOB}": false が無い(名指さないブランチ — Dependabot の dependabot/… など — は既定で自動デプロイされる)`;
  return null;
}

/** `crons` の欄の値の破れ。守っていれば null(中身の突合は j2-schedule-parity)。 */
function cronsProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return 'crons は並びでなければならない';
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) return `crons[${String(index)}] はオブジェクトでなければならない`;
    const extra = Object.keys(entry).filter((key) => !CRON_ENTRY_KEYS.includes(key));
    if (extra.length > 0) return `crons[${String(index)}] に許可表の外の欄がある(${extra.join(', ')})。書けるのは path / schedule だけ`;
    if (typeof entry['path'] !== 'string' || typeof entry['schedule'] !== 'string') return `crons[${String(index)}] の path / schedule は文字列でなければならない`;
  }
  return null;
}

/**
 * ホストの設定の本文の破れ(許可表の外の欄・値の形)。守っていれば空。
 *
 * @param text ファイルの本文
 * @returns 破れの説明の並び
 */
export function hostConfigProblems(text: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return ['JSON として読めない'];
  }
  if (!isRecord(parsed)) return ['最上位がオブジェクトでない'];
  const problems: string[] = [];
  for (const key of Object.keys(parsed)) {
    if (HOST_CONFIG_ALLOWED_KEYS.includes(key)) continue;
    const reason = Object.hasOwn(REJECT_REASONS, key) ? REJECT_REASONS[key] : '表に無い欄(口と出荷の経路を変えうるかを判断していない)';
    problems.push(`許可表の外の欄 ${key}(${reason ?? ''})`);
  }
  if (Object.hasOwn(parsed, '$schema') && typeof parsed['$schema'] !== 'string') problems.push('$schema は文字列でなければならない');
  if (Object.hasOwn(parsed, 'buildCommand') && parsed['buildCommand'] !== HOST_BUILD_COMMAND) problems.push(`buildCommand は "${HOST_BUILD_COMMAND}" だけ書ける(組み立ての命令を差し替えると、ビルドの入口の関所を飛ばせる)`);
  if (Object.hasOwn(parsed, 'crons')) {
    const problem = cronsProblem(parsed['crons']);
    if (problem !== null) problems.push(problem);
  }
  if (Object.hasOwn(parsed, 'regions')) {
    const regions = parsed['regions'];
    if (!Array.isArray(regions) || !regions.every((region) => typeof region === 'string')) problems.push('regions は文字列の並びでなければならない');
  }
  // git は必須(無ければ全ブランチが自動デプロイされる。C8-3)。
  const git = gitSectionProblem(parsed['git']);
  if (git !== null) problems.push(git);
  return problems;
}

/** ホストの設定に許すファイルの名前(この 1 つだけ。Cron の登録の置き場と同じ)。 */
export const HOST_CONFIG_FILE_NAME = CRON_CONFIG_FILE_NAME;

/**
 * 実装の木の直下の名前のうち、ホストの設定として読まれうる別の名前(`vercel.*` / `now.*` で `vercel.json` でないもの。大文字小文字を問わない)。
 *
 * @param names 実装の木の直下の名前
 * @returns 拒む名前(名前順)
 */
export function foreignHostConfigNames(names: readonly string[]): readonly string[] {
  return names.filter((name) => /^(?:vercel|now)\./i.test(name) && name !== HOST_CONFIG_FILE_NAME).sort();
}

/** 別の名前の設定ファイルの指摘(1 件にまとめる)。 */
function foreignNamesFinding(file: string, names: readonly string[]): Finding {
  const directory = path.posix.dirname(file);
  return {
    verifier: 'J2',
    severity: 'error',
    message: `${directory} にホストの設定として読まれうる別の名前のファイルがあります: ${names.join(' / ')}(設定の正は ${HOST_CONFIG_FILE_NAME} の 1 本。別の名前の設定は許可表が見ない)`,
    location: { file: path.posix.join(directory, names[0] ?? '') },
    suggestion: `設定は ${file} に書き、${names.join(' / ')} は消す(Vercel は vercel.ts などのプログラムの設定と古い now.json も読む)`,
    counterexample: { directory, names: names.join(' / ') },
    grounding: 'implementation',
  };
}

/** 実装の木があるのに `vercel.json` が無い(読めない)ことの指摘(10 回目 C10-5)。 */
function missingFinding(file: string): Finding {
  return {
    verifier: 'J2',
    severity: 'error',
    message: `${file} がありません(Git 連携の自動デプロイを止める git.deploymentEnabled を宣言できない。設定の無いリポジトリは Vercel の既定で全ブランチの push がデプロイされる)`,
    location: { file },
    suggestion: `${file} を置き、{ "git": { "deploymentEnabled": { "${ALL_BRANCHES_GLOB}": false } } } を書く(Cron を持たない製品も置く。crons は書かなくてよい)`,
    counterexample: { file, problems: 'ファイルが無い' },
    grounding: 'implementation',
  };
}

/**
 * 実装の木の直下のホストの設定を許可表で見る(J2 の続き。実装の木があれば `vercel.json` は必須 — 10 回目 C10-5)。
 *
 * @param input ジョブカタログ・リポジトリルート・製品の根
 * @returns 違反のリスト(別の名前の設定ファイルがあれば 1 件・`vercel.json` が無いか破れがあれば 1 件)
 */
export function verifyHostConfig(input: Pick<JobCheckInput, 'repoRoot' | 'roots'>): Finding[] {
  if (!appGrounded(input.repoRoot, input.roots.app)) return [];
  const file = cronConfigFile(input.roots);
  if (file === null) return [];
  const foreign = foreignHostConfigNames(listEntries(path.join(input.repoRoot, path.dirname(file))));
  const naming = foreign.length === 0 ? [] : [foreignNamesFinding(file, foreign)];
  const text = tryReadText(path.join(input.repoRoot, file));
  if (text === null) return [...naming, missingFinding(file)];
  const problems = hostConfigProblems(text);
  if (problems.length === 0) return naming;
  return [
    ...naming,
    {
      verifier: 'J2',
      severity: 'error',
      message: `${file} がホストの設定の許可表の外です: ${problems.join(' / ')}`,
      location: { file },
      suggestion:
        `${file} に書けるのは ${HOST_CONFIG_ALLOWED_KEYS.join(' / ')} だけで、git は { "deploymentEnabled": { "${ALL_BRANCHES_GLOB}": false, … } }(値は全部 false)。` +
        '転送・ヘッダ・URL の形の欄は前段と J2 の前提を壊すので書けない。欄が本当に要るなら理由を書いてホストの後段の許可表を直す',
      counterexample: { file, problems: problems.join(' / ') },
      grounding: 'implementation',
    },
  ];
}
