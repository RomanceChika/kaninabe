/**
 * 語彙漏れ検査(W 群)の実行口。
 *
 * 仕組み側コード(legacy/spec-tools/lib の体系全体 + app 側の仕組みに近い層)に、仕様が宣言した
 * id(集約・ロール・状態・イベント・語彙 id)と一致する文字列リテラルが無いことを見る(W1)。
 * 加えて、**アプリ側の仕組みの層の散文**に同じ語が例示の印なしで書かれていないことを見る(W2)。
 * ドメインモデルは lib/compose/verify-pipeline.ts がここへ来る時点で構築済みだが、通知・ジョブ・設定の各カタログは
 * 無い環境もあるため、それぞれの語彙軸は「あれば足す」(N / J / K 群と同じ扱い)。
 *
 * **通知 id・ジョブ id(カタログ本体の宣言 id)は対象に含めない。** J1 / N1 は「カタログの
 * 全 id に登録済みハンドラが 1 対 1 で対応すること」を実装側の**文字列リテラルによる
 * 登録**(`app/src/operation/jobs/handlers.ts` の `notificationHandler('notify_...', ...)`)
 * で担保する設計であり、config の環境変数名と同じ理由で W1 に含めると J1 / N1 と直接矛盾する
 * (実測: `handlers.ts` の登録一覧が全件自己違反した)。カタログの**語彙軸**
 * (`medium` / `audience` / `mention` / `kind` / `on_failure` の term id)は、この矛盾が無く
 * 「仕組み側のコードが分岐条件として直接比較してはいけない値」であるため引き続き対象にする。
 */

import type { SpecModel } from '../model/types.js';
import type { Finding } from '../kernel/finding.js';
import type { NotificationSpecModel } from '../model/notification/types.js';
import { NOTIFICATION_VOCABULARY_AXES } from '../model/notification/types.js';
import type { JobSpecModel } from '../model/job/types.js';
import { JOB_VOCABULARY_AXES } from '../model/job/types.js';
import type { ConfigSpecModel } from '../model/config/types.js';
import { CONFIG_VOCABULARY_AXES } from '../model/config/types.js';
import { verifyProseLeak } from './verifiers/w2-prose-leak.js';
import { countDeclaredOversize } from './oversize-count.js';
import { GENERALITY_STEPS } from './checks.js';
import type { ProductLayout } from '../model/product/layout.js';
import type { ProductRoots } from '../model/product/types.js';

/** runGeneralityVerification の入力。 */
export interface GeneralityRunInput {
  /** 構築済みのドメイン仕様モデル(集約・ロール・状態・イベント・settles の語彙の母集合)。 */
  readonly domain: SpecModel;
  /** 読み込み済みの通知カタログ(無ければ medium/audience/mention の語彙軸を足さない)。 */
  readonly notifications: NotificationSpecModel;
  /** 読み込み済みのジョブカタログ(無ければ kind/on_failure の語彙軸を足さない)。 */
  readonly jobs: JobSpecModel;
  /** 読み込み済みの設定カタログ(無ければ kind/requirement/used_by・設定 id を足さない)。 */
  readonly config: ConfigSpecModel;
  /** リポジトリルートの絶対パス(走査の起点)。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(走査範囲の位置と、W3 が禁じる綴りの値域)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(走査範囲の層と土台の表の宣言元。部品化 ③-c5)。 */
  readonly layout: ProductLayout;
}

/**
 * カタログの `vocabulary`(全軸)の id と、カタログ本体の宣言 id を集める。
 *
 * **設定カタログ(`config.variables[].id`。環境変数名)だけは除く。** K1(K 群)は
 * 「実装が設定を`process.env.NAME`の形で文字列リテラルとして参照していること」を要求する
 * (`env-scan.ts`「変数越しに読む書き方は拾えない。拾えない書き方をしないことは規約側が
 * 要求する」)。これは他の軸(集約・ロール・状態・イベント・通知/ジョブ id)が「仕組み側の
 * コードに書いてはいけない値域」であるのとは逆に、**あらゆる参照箇所に文字列として
 * 書かれていることをこそ検査する**設計であり、W1 に含めると K1 と直接矛盾する
 * (実測: `app/src/infrastructure/supabase/{client,session,proxy-session}.ts` の
 * `SUPABASE_URL` 等、`app/e2e/walker.config.mts` の `TZ` 等が自己違反した)。
 * 設定の語彙軸(`kind` / `requirement` / `used_by` の term id)自体はこの衝突が無いため含める。
 */
function catalogVocabularyWords(input: GeneralityRunInput): ReadonlySet<string> {
  const words = new Set<string>();
  // 製品の名前(`product.md` の `name`)。集約名や状態名とまったく同じ種類の語であり、
  // 仕組み側のコードに書かれていたら落とす —— 語彙に無いあいだ、実際に 1 か所生き残っていた
  // (束 ①-c-b のレビュー。`_template/actor-roles.ts` の散文の製品名)。
  if (input.roots.name !== null) words.add(input.roots.name);
  const notifications = input.notifications.catalog;
  if (notifications !== null) {
    for (const axis of NOTIFICATION_VOCABULARY_AXES) {
      for (const term of notifications.vocabulary[axis]) words.add(term.id);
    }
  }
  const jobs = input.jobs.catalog;
  if (jobs !== null) {
    for (const axis of JOB_VOCABULARY_AXES) {
      for (const term of jobs.vocabulary[axis]) words.add(term.id);
    }
  }
  const config = input.config.catalog;
  if (config !== null) {
    for (const axis of CONFIG_VOCABULARY_AXES) {
      for (const term of config.vocabulary[axis]) words.add(term.id);
    }
  }
  return words;
}

/**
 * 語彙漏れ検査(W1 + W2)を実行する。
 *
 * W1 は仕組み側コード全域の**文字列リテラル**(error)、W2 はアプリ側の仕組みの層の
 * **散文**(コメント・doc コメント。warning・ファイル単位)を見る。
 *
 * @param input ドメインモデル・通知/ジョブ/設定カタログ・リポジトリルート
 * @returns 全 Finding とヒット件数(CLI のサマリ表示用)
 */
export function runGeneralityVerification(input: GeneralityRunInput): {
  readonly findings: Finding[];
  /** `例:` の印で免除した散文の行数(台帳は持たないが、件数は必ず見えるようにする)。 */
  readonly exemptedLines: number;
  /** 300 行を超える**宣言つき**ファイルの本数(情報。warning ではない。増え方が見えるように毎回出す)。 */
  readonly oversizeDeclared: number;
} {
  const vocabulary = catalogVocabularyWords(input);
  const prose = verifyProseLeak(input.domain, vocabulary, input.repoRoot, input.roots, input.layout);
  const oversize = countDeclaredOversize(input.repoRoot, input.roots, input.layout);
  return {
    findings: GENERALITY_STEPS.flatMap((step) => step.run(input, { vocabulary, prose, oversize })),
    exemptedLines: prose.exemptedLines,
    oversizeDeclared: oversize.declared.length,
  };
}
