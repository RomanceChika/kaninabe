/**
 * V26 の**境界の候補**の導出(どの列を `actor.{欄}` に結べば、その書き込みはテナントを跨がないか)。
 *
 * 判定(`when` が結んでいるか・受け入れ・重さ)は `v26-tenant-write-boundary.ts`、ここは**結ぶべき列の束**を決めるだけで、
 * `when` も受け入れも見ない。境界の欄・列・祖先の導き方は V20 と共有する(`tenant-boundary-model.ts`)。
 *
 * **この検査はテナントの語を 1 つも持たない。**
 */

import type { EntitySpec, SpecModel } from '../../model/types.js';
import { isInputAbsent } from '../../model/types.js';
import { refColumn, refPathTo } from '../../model/ref-path.js';
import { ancestorsOf, boundaryOf, directRefColumns, matches, ownMatches, rawReach, tenantColumns, type BoundaryField } from './tenant-boundary-model.js';

/**
 * 書き込みで結ぶべき境界の候補 1 つ。
 *
 * `bindPaths` のどれかを `actor.{boundary}` と `==` で結べば閉じる。`acceptFields` は受け入れ(`accept[].filter`)が
 * 名指しできる列(V20 の読み取りの候補と同じ綴り: 自分の列は `{列}`・祖先の列は `{集約}.{列}`)。
 * `via` は、入力で受ける参照の欄を経て届く祖先の候補のときの、その参照の欄(無ければ null)。
 */
export interface WriteCandidate {
  readonly boundary: string;
  readonly bindPaths: readonly string[];
  readonly acceptFields: readonly string[];
  readonly via: string | null;
  /**
   * `context` に無い入力の参照の欄の先の境界の列(`bindPaths` は空)。自分の境界の列との等式を必須の項に持つ、執行点が実在する
   * 不変条件があれば結んだことに数える(A3-2(c))。
   */
  readonly tiePaths?: readonly string[];
  /** 境界の列を持つ表へ生の参照では届くが `context` で辿れない(境界を書けない形。A3-2(b))。 */
  readonly unreachable?: true;
}

/** 祖先の境界の列 1 本(`{集約}.{列}`)と、そこへ入力の参照の欄で届くか。 */
interface AncestorColumn {
  readonly path: string;
  /** 自分の参照の欄(入力で受けるなら、その欄の名前。DB の写し・届かないなら null)。 */
  readonly via: string | null;
}

/** 同じ入力の参照の欄を経て届く祖先の境界の列(どれか 1 本を結べば、その欄の先の行の会社は決まる)。 */
interface ViaGroup {
  readonly via: string;
  readonly paths: readonly string[];
  /**
   * `when` の左辺に書けるか(`context` でその欄を通って届く)。`context` に無い参照の欄(A3-2(c))は書けないので、
   * 実在する執行点を持つ不変条件(自分の境界の列と参照先の境界の列の等式)か `accept` だけが消す。
   */
  readonly bindable: boolean;
}

/** 祖先の境界の列を、届く参照の欄が入力か DB の写しかを添えて集める。 */
function ancestorColumns(
  model: SpecModel,
  entity: EntitySpec,
  boundary: BoundaryField,
  createInputs: readonly string[] | null | undefined,
): { readonly input: readonly ViaGroup[]; readonly copied: readonly AncestorColumn[] } {
  const input: AncestorColumn[] = [];
  const copied: AncestorColumn[] = [];
  for (const ancestor of ancestorsOf(model, entity)) {
    const route = refPathTo(model, entity.entity, ancestor.entity);
    const first = route?.[0];
    const column = first === undefined ? null : refColumn(model, entity.entity, first);
    const via = column === null ? undefined : entity.fields.find((field) => field.name === column);
    for (const field of ancestor.fields.filter((candidate) => matches(candidate, boundary))) {
      const path = `${ancestor.entity}.${field.name}`;
      if (via !== undefined && !isInputAbsent(via)) input.push({ path, via: via.name });
      else copied.push({ path, via: null });
    }
  }
  const groups = new Map<string, string[]>();
  for (const column of input) groups.set(column.via ?? '', [...(groups.get(column.via ?? '') ?? []), column.path]);
  const viaGroups: ViaGroup[] = [...groups].map(([via, paths]) => ({ via, paths, bindable: true }));
  // `context` に無い参照の欄でも、作成の入力で受けて境界の列を持つ表を直に指すなら候補にする(A3-2(c))。
  // 入力の欄は作成の action_spec の `input`(無ければ必須の欄)—— 入力に無い任意の欄は空で入るので、他の行を指せない。
  if (createInputs === undefined) return { input: viaGroups, copied };
  for (const direct of directRefColumns(model, entity, boundary)) {
    if (groups.has(direct.column)) continue;
    const field = entity.fields.find((candidate) => candidate.name === direct.column);
    if (field === undefined || isInputAbsent(field)) continue;
    if (createInputs === null ? field.required !== true : !createInputs.includes(field.name)) continue;
    viaGroups.push({ via: direct.column, paths: direct.paths, bindable: direct.bindable });
  }
  return { input: viaGroups, copied };
}

/**
 * そのエンティティが書き込みで結ぶべき境界の候補。
 *
 * 入力から来る自分の列は列ごとに 1 候補(その列そのものを結ぶ)。入力の参照の欄を経て届く祖先の列は、作成では 1 本ずつ候補になる
 * (編集では、その欄を書き換える規則にだけ当てはまる)。残り —— DB が埋める自分の列(作成では数えない)と DB の写しの祖先 —— は、
 * どれかを結べばよい 1 束にする。
 *
 * @param forCreate 作成か(DB が埋める自分の列を結べる列に数えない)
 * @param createInputs 作成の入力の欄(作成の action_spec が無ければ null = 必須の欄で代える)。作成のときだけ渡す
 */
export function writeCandidates(
  model: SpecModel,
  entity: EntitySpec,
  boundaries: readonly BoundaryField[],
  forCreate: boolean,
  createInputs?: readonly string[] | null,
): readonly WriteCandidate[] {
  const own = tenantColumns(entity, boundaries).flatMap((column) => {
    const field = entity.fields.find((candidate) => candidate.name === column);
    return field === undefined ? [] : [{ field, boundary: boundaryOf(field, boundaries, entity.entity) }];
  });
  return boundaries.flatMap((boundary): WriteCandidate[] => {
    const mine = own.filter((entry) => entry.boundary === boundary.name);
    // 自分の列が別の境界の欄の名で数えられているときは、V20 と同じく祖先に広げない。
    if (mine.length === 0 && entity.fields.some((field) => ownMatches(field, boundary, entity.entity))) return [];
    const supplied = mine.filter((entry) => !isInputAbsent(entry.field));
    const derived = mine.filter((entry) => isInputAbsent(entry.field)).map((entry) => entry.field.name);
    const { input, copied } = ancestorColumns(model, entity, boundary, forCreate ? (createInputs ?? null) : undefined);
    const out: WriteCandidate[] = supplied.map((entry) => ({
      boundary: boundary.name,
      bindPaths: [`${entity.entity}.${entry.field.name}`],
      acceptFields: [entry.field.name],
      via: null,
    }));
    for (const group of input) {
      out.push({
        boundary: boundary.name,
        bindPaths: group.bindable ? group.paths : [],
        acceptFields: group.bindable ? group.paths : [group.via, ...group.paths],
        via: group.via,
        ...(group.bindable ? {} : { tiePaths: group.paths }),
      });
    }
    const bindable = input.filter((group) => group.bindable);
    if (supplied.length > 0 || (forCreate && bindable.length > 0)) return out;
    const ownPaths = forCreate ? [] : derived.map((name) => `${entity.entity}.${name}`);
    const bundle = [...ownPaths, ...copied.map((column) => column.path), ...(forCreate ? [] : bindable.flatMap((group) => group.paths))];
    if (bundle.length === 0 && derived.length === 0 && bindable.length === 0) {
      // 自分も `context` の祖先も境界の列を持たないのに、生の参照では届く —— 境界を書けない形(A3-2(b))。黙らせない。
      // 入力の参照の欄ごとの候補(結べない形)を既に出していれば、同じ欄を二度言わない。
      const reach = mine.length === 0 && out.length === 0 ? rawReach(model, entity, boundary) : [];
      if (reach.length > 0) out.push({ boundary: boundary.name, bindPaths: [], acceptFields: reach, via: null, unreachable: true });
      return out;
    }
    const accepts = [...derived, ...copied.map((column) => column.path), ...bindable.flatMap((group) => group.paths)];
    out.push({ boundary: boundary.name, bindPaths: bundle, acceptFields: accepts, via: null });
    return out;
  });
}
