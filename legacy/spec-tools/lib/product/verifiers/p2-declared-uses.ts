/**
 * P2: **採る仕様の種類(`uses`)の宣言と、仕様の置き場の突合**(両方向・error)。
 *
 * 検査が「何も言わずに通る」のは 2 つの形がある。
 *
 *   - **採ったのに無い**(宣言あり・置き場なし)… その種類を要る検査は何も見つけず、緑になる。
 *     仕様を消した・置き場を動かした・綴りを間違えた日に、検査だけが静かに空振りする形である。
 *   - **あるのに採っていない**(置き場あり・宣言なし)… その種類の入力は「未選択」として扱われ、
 *     その種類を要る検査は**未実施**になる。仕様があるのに検査から外れていると、書いた仕様が黙って
 *     無視される(宣言を足し忘れた日に起きる)。
 *
 * どちらも**推定で埋めない**。ファイルがあるから採っているとも、無いから採っていないとも言わず、
 * 宣言と実在の食い違いをそのまま error にする。
 *
 * 3 つ目の形は**採る種類同士の依存**(`SPEC_KIND_REQUIREMENTS`。例: 連携があるなら設定カタログも採る・受信の連携があるなら
 * テーブル仕様も採る)。仕様の側が必ず別の種類を名指すのに、名指された先を採っていないと、名指しの接地を見る検査が「接地先は無い」と読んで
 * 何も言わない。**宣言の段で止める**。名指しが連携の 1 件ごとに生まれる依存は、その仕様の中身を読んで、名指す連携があるときだけ要求する
 * (0 件のカタログは何も名指さない)。**ドメイン仕様も依る側になる** —— ドメイン仕様は `uses` に載らない(どの製品にも要る)が、副作用の宣言
 * (`effects[].do` / `writes[].effects`)はジョブカタログを、通知の ID はさらに通知カタログを名指す。ジョブカタログの走査の `emits` も
 * 通知カタログを名指す。中身を読んで、名指しが 1 件でもあれば要求する。**上の 2 つの形で同じ種類がすでに指摘されているときは、同じ「uses に足す」を重ねて言わない**(1 件にする)。
 *
 * **読めるか(壊れていないか)は言わない。** 置き場に仕様があって採ったのに読めないときの文言は、
 * 各種類のローダーの 0 番の検査(J0 / T0 / N0 …)がすでに持つ。ここで重ねると同じ事実を 2 回数える。
 * 読めない種類を要る検査は「阻害」として報告される(`kernel/input-state.ts`)。
 */

import path from 'node:path';
import { isDirectory, isFile, PRODUCT_DECL_FILE, walkFiles } from '../../io/paths.js';
import type { Finding } from '../../kernel/finding.js';
import { loadExternalSpecModel } from '../../model/external/loader.js';
import { loadJobSpecModel } from '../../model/job/loader.js';
import { loadSpecModel } from '../../model/loader.js';
import { collectJobEffects, collectNotifyEffects } from '../../model/notification/effect-refs.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots, ProductRootsModel } from '../../model/product/types.js';
import {
  requiringKindUsed,
  SPEC_KINDS,
  SPEC_KIND_PLACEMENTS,
  SPEC_KIND_REQUIREMENTS,
  usesKind,
  type ProductUses,
  type SpecKind,
  type SpecKindCondition,
  type SpecKindRequirement,
} from '../../model/product/uses.js';

/** 検証器 ID。 */
export const P2_VERIFIER_ID = 'P2';

/** P2 の入力。 */
export interface DeclaredUsesInput {
  /** リポジトリルートの絶対パス。 */
  readonly repoRoot: string;
  /** 読み込んだ宣言(根)。 */
  readonly product: ProductRootsModel;
  /** 製品が採ると宣言した種類(宣言が読めなかったときは null)。 */
  readonly uses: ProductUses | null;
}

/** README とテンプレート以外の `.md`(= 実物の仕様)か。 */
function isSpecFile(name: string): boolean {
  return name.endsWith('.md') && name !== 'README.md' && !name.startsWith('template.');
}

/** その種類の仕様が、置き場に 1 枚でもあるか。 */
function hasSpecs(repoRoot: string, roots: ProductRoots, kind: SpecKind): boolean {
  const placement = SPEC_KIND_PLACEMENTS[kind];
  return placement.paths.some((relative) => {
    const absolute = path.join(repoRoot, specPath(roots, relative));
    return placement.shape === 'file' ? isFile(absolute) : walkFiles(absolute, isSpecFile).length > 0;
  });
}

/** 置き場の候補を人に示す綴り(仕様の木からの相対パスを、宣言された根の下で示す)。 */
function placesOf(roots: ProductRoots, kind: SpecKind): string {
  return SPEC_KIND_PLACEMENTS[kind].paths.map((relative) => specPath(roots, relative)).join(' / ');
}

/**
 * 採用の宣言と置き場の食い違いを検査する。
 *
 * @param input リポジトリルート・読み込んだ宣言・採る種類
 * @returns P2 違反(食い違う種類ごとに 1 件)
 */
export function verifyDeclaredUses(input: DeclaredUsesInput): Finding[] {
  const roots = input.product.roots;
  // 宣言が読めなかった場合の文言は P0 が持つ。仕様の木が無い場合は P1 が持つ(ここで連鎖させない)。
  if (roots === null || input.uses === null) return [];
  const uses = input.uses;
  if (!isDirectory(path.join(input.repoRoot, roots.specs))) return [];

  const findings: Finding[] = [];
  // 採用の宣言と置き場の食い違いが指摘済みの種類(依存の指摘で同じことを重ねて言わない)。
  const mismatched = new Set<SpecKind>();
  for (const kind of SPEC_KINDS) {
    const declared = usesKind(uses, kind);
    const present = hasSpecs(input.repoRoot, roots, kind);
    if (declared === present) continue;
    mismatched.add(kind);
    findings.push(declared ? declaredButAbsent(kind, roots) : presentButUndeclared(kind, roots));
  }
  // 条件が読むのは依る側の仕様の中身(外部連携カタログ・ドメイン仕様・ジョブカタログ)だけで、要求が残る種類だけを読む。
  const facts = new LazyFacts(input.repoRoot, roots);
  for (const requirement of SPEC_KIND_REQUIREMENTS) {
    if (!requiringKindUsed(uses, requirement.kind) || usesKind(uses, requirement.requires)) continue;
    // 依る側が置き場に無い(declaredButAbsent)・先が置き場に既にある(presentButUndeclared)ときは、その指摘が同じ直し方を言っている。
    if (requirement.kind !== 'domain' && mismatched.has(requirement.kind)) continue;
    if (mismatched.has(requirement.requires)) continue;
    if (conditionHolds(facts.count(requirement.when))) findings.push(requiredButUndeclared(requirement));
  }
  return findings;
}

/** 依存の条件の数え方の結果。数えられないときは null、行を落としていれば `complete` が false。 */
interface CountedFact {
  readonly count: number;
  readonly complete: boolean;
}

/**
 * 依存の条件が読む仕様の中身を、要るときに 1 回だけ読む(読み込みの診断はここでは使わない —— X0 / V1 / J0 が出す)。
 * 数えるだけなので、行を落としていれば `complete` を false にする。
 */
class LazyFacts {
  private readonly cache = new Map<FactSource, Counter | null>();

  constructor(
    private readonly repoRoot: string,
    private readonly roots: ProductRoots,
  ) {}

  /** 条件が数える件数(読めない・置き場が無いときは null)。 */
  count(when: SpecKindCondition): CountedFact | null {
    const source = SOURCE_OF[when];
    if (!this.cache.has(source)) this.cache.set(source, this.load(source));
    const counter = this.cache.get(source) ?? null;
    return counter === null ? null : counter(when);
  }

  private load(source: FactSource): Counter | null {
    switch (source) {
      case 'external':
        return this.external();
      case 'domain':
        return this.domain();
      case 'jobs':
        return this.jobs();
    }
  }

  /** 外部連携カタログの連携の数と受信の数。 */
  private external(): Counter | null {
    const [relative] = SPEC_KIND_PLACEMENTS.external.paths;
    if (relative === undefined) return null;
    const loaded = loadExternalSpecModel(path.join(this.repoRoot, specPath(this.roots, relative)), { repoRoot: this.repoRoot });
    const catalog = loaded.model.catalog;
    if (catalog === null) return null;
    const complete = loaded.dropped === 0;
    const inbound = catalog.integrations.filter((integration) => integration.direction === 'inbound').length;
    return (when) => ({ count: when === 'has-inbound-integration' ? inbound : catalog.integrations.length, complete });
  }

  /** ドメイン仕様の副作用の数と、そのうち通知の数。 */
  private domain(): Counter | null {
    const root = path.join(this.repoRoot, specPath(this.roots, 'domain'));
    // ドメイン仕様の木そのものが無い製品は何も名指さない(無いことの error は V1 が言う。ここで連鎖させない)。
    if (!isDirectory(root)) return () => ({ count: 0, complete: true });
    const loaded = loadSpecModel(root, { repoRoot: this.repoRoot });
    const model = loaded.model;
    if (model === null) return null;
    // 副作用を宣言する 2 種類(state_spec / access_spec)に読めない error があれば(V1)、落とした宣言が副作用を
    // 持っていたかもしれないので「副作用は無い」と言い切らない。他のファイルの error(roles.md など)では言い切ってよい。
    const complete = !loaded.findings.some(
      (finding) => finding.severity === 'error' && EFFECT_FILES.some((name) => finding.location.file.endsWith(`/${name}`)),
    );
    const effects = collectJobEffects(model).length;
    const notify = collectNotifyEffects(model).length;
    return (when) => ({ count: when === 'has-notify-effects' ? notify : effects, complete });
  }

  /** ジョブカタログの走査が積む通知の数。 */
  private jobs(): Counter | null {
    const [relative] = SPEC_KIND_PLACEMENTS.jobs.paths;
    if (relative === undefined) return null;
    const loaded = loadJobSpecModel(path.join(this.repoRoot, specPath(this.roots, relative)), { repoRoot: this.repoRoot });
    const catalog = loaded.model.catalog;
    if (catalog === null) return null;
    const emits = catalog.jobs.reduce((sum, decl) => sum + (decl.schedule?.emits?.length ?? 0), 0);
    return () => ({ count: emits, complete: loaded.dropped === 0 });
  }
}

/** 副作用を宣言するドメイン仕様のファイル(`effects[].do` は state_spec、`writes[].effects` は access_spec)。 */
const EFFECT_FILES: readonly string[] = ['states.md', 'access.md'];

/** 読み込んだ仕様から条件ごとの件数を返す関数。 */
type Counter = (when: SpecKindCondition) => CountedFact;

/** 条件が読む仕様の出どころ。 */
type FactSource = 'external' | 'domain' | 'jobs';

/** 条件ごとの出どころ(網羅は型が見る)。 */
const SOURCE_OF: Readonly<Record<SpecKindCondition, FactSource>> = {
  'has-integration': 'external',
  'has-inbound-integration': 'external',
  'has-domain-effects': 'domain',
  'has-notify-effects': 'domain',
  'has-schedule-emits': 'jobs',
};

/**
 * 依存が効く条件を満たすか。**数えられないときは効くものとして扱う**(読めない・行を落とした仕様に「名指す先は無い」と
 * 言い切って要求を外すと、壊れた仕様の日に依存の指摘だけが静かに消える。原因の error は各種類の 0 番の検査が出している)。
 */
function conditionHolds(fact: CountedFact | null): boolean {
  if (fact === null) return true;
  return fact.count > 0 || !fact.complete;
}

/** ある種類を採っているのに、それが必ず名指す別の種類を採っていない。 */
function requiredButUndeclared(requirement: SpecKindRequirement): Finding {
  const { kind, requires } = requirement;
  const subject = kind === 'domain' ? `ドメイン仕様が ${requires} を名指す宣言を持っています` : `uses に ${kind} を宣言しています`;
  const otherwise =
    kind === 'domain' ? 'その宣言(副作用の ID)を持たせないなら、ドメイン仕様から外す' : `${kind} を採らないなら uses から外す`;
  return {
    verifier: P2_VERIFIER_ID,
    severity: 'error',
    message: `${subject}が、${requires} の宣言がありません(${requirement.because})`,
    location: { file: PRODUCT_DECL_FILE, pointer: 'uses' },
    suggestion: `uses に ${requires} を足して ${requires} の仕様を作る。${otherwise}`,
    counterexample: { kind, requires },
  };
}

/** 採ると宣言したのに、置き場に仕様が無い。 */
function declaredButAbsent(kind: SpecKind, roots: ProductRoots): Finding {
  return {
    verifier: P2_VERIFIER_ID,
    severity: 'error',
    message: `uses に ${kind} を宣言していますが、その置き場(${placesOf(roots, kind)})に仕様がありません`,
    location: { file: PRODUCT_DECL_FILE, pointer: 'uses' },
    suggestion:
      `${kind} の仕様をその置き場に作るか、採らないなら uses から ${kind} を外す` +
      '(採ったのに無い種類を要る検査は「阻害」と報告される。黙って緑にはならない)',
    counterexample: { kind, places: placesOf(roots, kind) },
  };
}

/** 置き場に仕様があるのに、採ると宣言していない。 */
function presentButUndeclared(kind: SpecKind, roots: ProductRoots): Finding {
  return {
    verifier: P2_VERIFIER_ID,
    severity: 'error',
    message: `${kind} の仕様が置き場(${placesOf(roots, kind)})にありますが、uses に宣言がありません`,
    location: { file: PRODUCT_DECL_FILE, pointer: 'uses' },
    suggestion:
      `採るなら uses に ${kind} を足す。採らないなら置き場の仕様を消す` +
      '(宣言が無い種類は「未選択」として扱われ、その種類を要る検査は「未実施」になる —— 書いた仕様が検査から黙って外れる)',
    counterexample: { kind, places: placesOf(roots, kind) },
  };
}
