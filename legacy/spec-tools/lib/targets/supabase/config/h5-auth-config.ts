/**
 * H5 サインインの方式と公開スキーマの突合(Supabase の後段が登録する検査。設定の綴りは Supabase のもの) —
 * ローカル設定 `config.toml` を、認証フロー仕様の宣言(`providers` / `local_only`)とプラットフォームの設定(`exposedSchema`)に突き合わせる。
 *
 * 設定は**宣言の許す範囲を超えて開けない**(閉世界):
 *   - 開いているサインインの方式は `providers`(と、ローカルでだけ開けてよい `local_only`)に載っているものだけ。見る口は 6 つ —
 *     メールの登録(`[auth.email] enable_signup` → `email`)・SMS の登録(`[auth.sms] enable_signup` → `phone`)・
 *     匿名(`[auth] enable_anonymous_sign_ins` → `anonymous_sign_in`)・外部プロバイダ(`[auth.external.{名}] enabled` → `{名}`)・
 *     外部の認証基盤(`[auth.third_party.{名}] enabled` → `{名}`)・ウォレット(`[auth.web3.{名}] enabled` → `{名}`)
 *   - 外へ出すスキーマ(`[api] schemas`)は `PlatformProfile.exposedSchema` の 1 つだけ(GraphQL など、使っていない口を増やさない)
 *   - セッションの寿命(`[auth.sessions] timebox` / `inactivity_timeout`)は認証フロー仕様の `sessions` と同じ長さ。アクセストークンの寿命
 *     (`[auth] jwt_expiry`)は無操作の時間切れより短く、更新トークンの回転(`[auth] enable_refresh_token_rotation`)は無効にしない(`h5-sessions.ts`)
 *   - 認証フロー仕様が多要素認証を要求するなら、要素(`[auth.mfa.totp]` など)が 1 つ以上、登録も確認も有効(`h5-mfa.ts`)
 *   - 本番の方式にメール(パスワード)を置くなら、パスワードの最短の長さが 8 以上・メールアドレスの確認あり・パスワードの変更に再認証あり(`h5-password.ts`。ASVS L2)
 *   - 戻り先の許可リスト(`[auth] site_url` / `additional_redirect_urls`)は、宣言した帰り道(`callback.endpoint`)だけを指す(`h5-redirects.ts`)
 *   - **deploy 先(`[remotes.{名}]`)の設定も同じ規則で見る**が、許すのは `providers` だけ(`local_only` はローカルでだけ開けてよい方式)。
 *     deploy 先は基の設定に上書きを重ねたものとして読む
 *
 * **書かれていないキーは、Supabase の既定で読む**(CLI は同梱の雛形を既定にする): `[auth.email] enable_signup` は有効・`[api] schemas` は
 * 公開スキーマ + GraphQL。書き忘れが開いたままの口になる経路を作らない。
 *
 * **フルパスに畳めない書き方は読まずに赤にする**: `auth` / `api` / `remotes` の下のインラインテーブル・ドット付きのキー・引用符つきでドットを含む
 * セクション名・配列表は、開いている口を見落とす書き方なので、普通のセクションへの書き直しを求める(読み落とした「開いている」を「閉じている」にしない)。
 *
 * **三連の引用符(複数行の文字列)がファイルのどこかにあれば、ファイル全体を error にして口の突合を出さない**(読み飛ばしのずれが開いている口を隠す経路を残さない)。
 *
 * `[auth] enabled = false`(認証を動かさない)・`[api] enabled = false`(データ API を動かさない)なら、その部分は見ないが、**見なかった理由を未実施として返す**
 * (黙って飛ばさない)。設定ファイルが無ければ未実施(緑にしない)。ローカルの設定ファイルが検査できる範囲で、本番(管理画面側)の設定との一致は見ていない。
 */

import path from 'node:path';
import { tryReadText } from '../../../io/read-text.js';
import type { AuthConfigInput, AuthConfigOutcome, AuthConfigVerifier } from '../../../auth/platform-config.js';
import { H5_ID } from '../../../auth/platform-config.js';
import type { Finding } from '../../../kernel/finding.js';
import { stackConfigPath } from '../../../model/product/paths.js';
import { parseToml } from './config-toml.js';
import type { TomlDoc, TomlShape } from './config-toml.js';
import { exposureResult, h5Finding, signInResult } from './h5-doors.js';
import { redirectResult } from './h5-redirects.js';
import type { Scope } from './h5-doors.js';
import { sessionsResult } from './h5-sessions.js';
import { mfaResult } from './h5-mfa.js';
import { passwordResult } from './h5-password.js';

/** この検査が読む範囲の最上位のセクション。 */
const WATCHED = ['auth', 'api', 'remotes'];

/** 読まなかった書き方の説明。 */
const SHAPE_WORDS: Readonly<Record<TomlShape['kind'], string>> = {
  inline_table: 'がインラインテーブル({ … })で書かれています',
  dotted_key: 'がドット付きのキーで書かれています',
  quoted_dotted_section: 'が引用符つきでドットを含むセクション名です',
  array_table: 'が配列表([[…]])です',
  multiline_string: 'が複数行の文字列(""" / \'\'\')で書かれています',
  escaped_name: 'がエスケープを含む引用符つきの名前で書かれています',
  unrecognized_line: '',
};

/** 書き方の場所の最上位の名前(ルートの書き方はキーの先頭。読めない行は、見出しに見える行ならその名前)。 */
function topOf(shape: TomlShape): string {
  const named = shape.kind === 'unrecognized_line' && shape.key.startsWith('[') ? shape.key.replace(/^[\s[\]"']+/, '') : shape.section === '' ? shape.key : shape.section;
  return named.split(/[.\]\s"']/)[0] ?? '';
}

/** 読まなかった書き方の指摘。 */
function shapeFindings(shapes: readonly TomlShape[], file: string): Finding[] {
  return shapes
    .filter((shape) => WATCHED.includes(topOf(shape)))
    .map((shape) => {
      if (shape.kind === 'unrecognized_line') {
        return h5Finding(file, shape.section === '' ? shape.key : `[${shape.section}]`, {
          message: `${file} の ${shape.section === '' ? 'ルート' : `[${shape.section}]`} の行「${shape.key}」が、セクションの見出しでも キー = 値 でもなく、読めません。この行が設定の一部なら、読み落とした口が開いているかもしれません`,
          suggestion: '見出しは [名前]、設定は キー = 値 の 1 行で書く(見出しの後ろに文字を続けない・] を閉じる)。読めない行は消すか書き直す',
          counterexample: { section: shape.section, line: shape.key, kind: shape.kind },
        });
      }
      const place = shape.section === '' ? shape.key : shape.key === '' ? `[${shape.section}]` : `[${shape.section}] ${shape.key}`;
      return h5Finding(file, shape.section === '' ? shape.key : shape.key === '' ? `[${shape.section}]` : `[${shape.section}].${shape.key}`, {
        message: `${file} の ${place} ${SHAPE_WORDS[shape.kind]}。この書き方は開いている口を読み落とすので、閉じているとも開いているとも判定できません`,
        suggestion: '普通の [セクション] と キー = 値 の形に書き直す(インラインテーブルは [セクション] に、ドット付きのキーは [a.b.c] のセクションに、引用符つきの名前はドットもエスケープも含まない名前に、複数行の文字列は使わない)',
        counterexample: { section: shape.section, key: shape.key, kind: shape.kind },
      });
    });
}

/** deploy 先の名前の一覧(`[remotes.{名}…]` のセクションから)。 */
function remoteNames(doc: TomlDoc): readonly string[] {
  return [...new Set([...doc.keys()].flatMap((section) => (section.startsWith('remotes.') ? [section.split('.')[1] ?? ''] : [])))].filter((name) => name !== '');
}

/** deploy 先の有効な設定(基の設定に、deploy 先の上書きを重ねる)と、deploy 先が自分で書いたキー。 */
function overlay(doc: TomlDoc, remote: string): { readonly effective: TomlDoc; readonly written: Set<string> } {
  const effective = new Map([...doc].map(([section, keys]) => [section, new Map(keys)] as const));
  const written = new Set<string>();
  const prefix = `remotes.${remote}.`;
  for (const [section, keys] of doc) {
    if (!section.startsWith(prefix)) continue;
    const base = section.slice(prefix.length);
    const target = effective.get(base) ?? new Map();
    for (const [key, value] of keys) {
      target.set(key, value);
      written.add(`${base}\0${key}`);
    }
    effective.set(base, target);
  }
  return { effective, written };
}

/**
 * 三連の引用符(`"""` / `'''`)がファイルのどこか(どのセクションの中でも、ほかの文字列やコメントの中でも)にあれば、ファイル全体の指摘にする。
 * 複数行の文字列は閉じるまでの行を設定として読めず、読み飛ばしの位置がずれると(配列の中の文字列に紛れた三連の引用符・インラインテーブルの中の
 * 複数行の文字列・閉じていない文字列)、後ろの本物の設定を飲み込むか、偽の設定を本物として読む。**読み違えうるファイルから読んだ口は信用しない**ので、
 * 口の突合は出さずこの 1 件だけを返す(この製品の設定は三連の引用符を使わない)。
 */
function tripleQuoteFinding(text: string, file: string): Finding | null {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => line.includes('"""') || line.includes("'''"));
  if (at < 0) return null;
  return h5Finding(file, `line ${at + 1}`, {
    message: `${file} の ${at + 1} 行目に三連の引用符(""" または ''')があります。複数行の文字列は中身を設定として読めず、読み飛ばしのずれが開いている口を隠すので、このファイルから読んだ口の突合は信用できません`,
    suggestion: '三連の引用符を使わない(1 行の文字列と普通の キー = 値 に書き直す。コメントの中でも使わない)',
    counterexample: { kind: 'triple_quote', line: String(at + 1) },
  });
}

/** 突合の結果(違反と、見なかった理由)。 */
export interface AuthConfigFindings {
  readonly findings: Finding[];
  readonly skipped: string[];
}

/**
 * 設定の本文を宣言に突き合わせる(純粋。ファイルを読まない)。
 *
 * @param text `config.toml` の本文
 * @param file 設定ファイルのリポジトリルート相対パス(指摘の位置に出す)
 * @param input 宣言した方式とセッションの寿命
 * @returns 違反(読まなかった書き方 → ローカル → deploy 先ごとの順)と、見なかった理由
 */
export function authConfigFindings(text: string, file: string, input: AuthConfigInput): AuthConfigFindings {
  const triple = tripleQuoteFinding(text, file);
  if (triple !== null) return { findings: [triple], skipped: [] };
  const { doc, shapes } = parseToml(text);
  const providers = input.providers;
  const localOnly = input.localOnly.map((entry) => entry.method);
  const findings = shapeFindings(shapes, file);
  const skipped: string[] = [];
  if ((doc.get('remotes')?.size ?? 0) > 0) {
    findings.push(h5Finding(file, '[remotes]', { message: `${file} の [remotes] 直下にキーがあります。deploy 先の設定として読めません`, suggestion: 'deploy 先の設定は [remotes.{名}] のセクションに書く', counterexample: { section: 'remotes' } }));
  }
  const scopes: readonly Scope[] = [
    { doc, file, remote: null, allowed: [...providers, ...localOnly], localOnly, written: null },
    ...remoteNames(doc).map((remote): Scope => {
      const { effective, written } = overlay(doc, remote);
      return { doc: effective, file, remote, allowed: providers, localOnly, written };
    }),
  ];
  for (const scope of scopes) {
    for (const result of [signInResult(scope, providers), exposureResult(scope), sessionsResult(scope, input.sessions), mfaResult(scope, input.mfa), passwordResult(scope, providers), redirectResult(scope, input.callback)]) {
      findings.push(...result.findings);
      skipped.push(...result.skipped);
    }
  }
  return { findings, skipped };
}

/**
 * ローカル設定を読んで宣言と突き合わせる(H5 の本体)。設定ファイルが無い・読めないなら `absent`(未実施)。
 *
 * @param input 宣言した方式・リポジトリルート・製品の根
 */
function verifyAuthConfig(input: AuthConfigInput): AuthConfigOutcome {
  const file = stackConfigPath(input.roots);
  const text = tryReadText(path.join(input.repoRoot, file));
  if (text === null) return { status: 'absent', file };
  return { status: 'checked', file, ...authConfigFindings(text, file, input) };
}

/** Supabase の後段が登録する H5。 */
export const SUPABASE_AUTH_CONFIG: AuthConfigVerifier = { id: H5_ID, verify: verifyAuthConfig };
