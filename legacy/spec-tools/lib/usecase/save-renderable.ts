/**
 * 保存点が**複合 RPC に写せる形か**の判定(検査 Y12 と生成器が共有する 1 つの規則)。
 *
 * `param-source.ts` が「引数の供給元が決まるか」(Y8)、`plan-facts.ts` が「`permit` が要る値の
 * 供給元が決まるか」(Y10)を見るのに対し、ここは**決まった供給元が plpgsql の字面に写せるか**を
 * 見る。写せない形は 2 つある。
 *
 *   1. **計算値(`computes`)と編集の副作用** —— どちらも値を決めるのが TS 側なので、
 *      複合 RPC の中には置き場が無い。
 *   2. **再送(冪等)のときに読み直せない手順** —— 複合 RPC の再送は「最初に作る行から
 *      参照の鎖を辿る」形しか持たないので、鎖に乗らない手順(保存点の外にある別集約への
 *      遷移・親を持たない兄弟行を N 行作る形)は写せない。
 *
 * どちらも**以前は生成器が例外を投げていた** —— `verify` は緑のまま `generate` が
 * スタックトレースで落ちるので、「仕様の問題」として読めなかった(束 ⑱ の題材 A / C / D が
 * 3 件実測)。判定をここに置き、検査(Y12)と生成器の両方が**同じ 1 つの関数**を呼ぶ。
 * 再送の側は `save-readback.ts` の `readbackPlans` が**問い合わせの構造まで**返す —— 生成器が
 * 同じ判定をもう一度回すと、条件がずれた瞬間に空の SQL 式が migration に出るためである
 * (束 ⑲-1 のレビュー)。
 *
 * **アプリの語彙は 1 語も持たない。**
 */

import type { ParamSource, ResolvedParam } from './param-source.js';
import type { PlanProblem, SavePlan } from './step-plan.js';
import { at } from './param-source-facts.js';

/**
 * 複合 RPC の引数に渡せる供給元(`ParamSource` から写せないものを除いた形)。
 *
 * 型で除いてあるのは、生成器の switch を**網羅**にして「前提が破れたときに throw する
 * 既定の枝」を持たせないためである(scripts-code-quality.md §生成器は throw しない)。
 */
export type CompositeParamSource = Exclude<ParamSource, { readonly kind: 'computed' } | { readonly kind: 'write_effects' }>;

/** 複合 RPC の引数 1 本(供給元が写せる形に絞られている)。 */
export interface CompositeResolvedParam {
  readonly name: string;
  readonly source: CompositeParamSource;
}

/**
 * 複合 RPC に写せない供給元の kind(型側の `Exclude` の**裏**をそのまま取る)。
 *
 * こう書くことで `UNRENDERABLE` の鍵が `CompositeParamSource` の `Exclude` と**同じ集合で
 * あることを tsc が強制する** —— 4 つ目の写せない kind を型にだけ足したらコンパイルが落ちる。
 * `Partial` で持っていた頃は鍵が欠けても型が通り、`narrowCompositeParams` が `ok: true` を
 * 返して生成器の網羅 switch に来ない kind が SQL に出る(束 ⑲-1 のレビュー)。
 */
type UnrenderableKind = Exclude<ParamSource['kind'], CompositeParamSource['kind']>;

/** 写せない供給元ごとの対処(値域。kind ごとに 1 文)。 */
const UNRENDERABLE: Readonly<Record<UnrenderableKind, string>> = {
  computed:
    '計算値を決めるのは実行器(TS)であり、複合 RPC の中には置き場が無い。その手順を保存点から外して' +
    '単発の操作にする(保存点を分ける)か、その欄を入力・supplied_by: db に変えて computes をやめる',
  write_effects:
    '編集の副作用は判断の結果から決まるので、保存点の中では値が定まらない。保存点に置ける手順は' +
    '作成と遷移だけである',
};

/** kind から対処を引く(鍵が閉じているので Map で持つ = 無検査の索引を書かない)。 */
const UNRENDERABLE_BY_KIND: ReadonlyMap<string, string> = new Map(Object.entries(UNRENDERABLE));

/** 複合 RPC に渡せる供給元か(絞り込みの述語。型側の `Exclude` と同じ判定を 1 か所で持つ)。 */
function isComposite(param: ResolvedParam): param is CompositeResolvedParam {
  return !UNRENDERABLE_BY_KIND.has(param.source.kind);
}

/** 写せない供給元の名前(反例に出す用)。 */
function unrenderableField(source: ParamSource): string {
  if (source.kind === 'computed') return source.field;
  return '';
}

/**
 * 解決済みの引数を「複合 RPC に渡せる形」に絞る。1 本でも写せなければ問題を返す。
 *
 * @param plan 接地済みの保存点
 * @param steps 手順ごとの解決済み引数(`resolveSaveParams` の結果。宣言順)
 * @returns 絞り込めた引数、または理由つきの失敗(3 点セット)
 */
export function narrowCompositeParams(
  plan: SavePlan,
  steps: readonly (readonly ResolvedParam[])[],
):
  | { readonly ok: true; readonly steps: readonly (readonly CompositeResolvedParam[])[] }
  | { readonly ok: false; readonly problems: readonly PlanProblem[] } {
  const problems: PlanProblem[] = [];
  for (const [index, params] of steps.entries()) {
    const step = plan.steps[index];
    if (step === undefined) continue;
    for (const param of params) {
      const suggestion = UNRENDERABLE_BY_KIND.get(param.source.kind);
      if (suggestion === undefined) continue;
      problems.push({
        message: `手順 ${step.op} の引数 ${param.name} の供給元(${param.source.kind})は複合 RPC に渡せません`,
        suggestion,
        counterexample: { ...at(plan, step), param: param.name, field: unrenderableField(param.source) },
      });
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  // 述語で絞る(`as` の無検査キャストを持たない)。問題が 0 件なら 1 本も落ちない。
  return { ok: true, steps: steps.map((params) => params.filter(isComposite)) };
}
