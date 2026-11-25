/**
 * 集約の章(`domain/{集約}.html`)の部品が共有する材料と、章どうしの繋ぎ。
 *
 * 章 1 本の材料(`DomainEnv`)は、モデル・文脈・集計(`faceFacts`)・章のファイルである。
 * それに、HTML の本が足す 2 つ(流れの図の事実を引く口・語釈の引き先)を持つ。繋ぎは `.md` へは張らず、HTML の章(`./{章}.html`)と
 * 新しい形の章(`../spec/{集約}.html`)へ張る。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { LifecycleFacts } from '../../../../semantics/spec-book/lifecycle-facts.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import { roleLabels } from '../access-view.js';
import type { FaceFacts } from '../face-facts.js';
import { sectionAnchor, type BookLayout } from '../face-scope.js';
import type { Glossary } from './face-parts.js';
import { el, url, type Child, type Html } from './markup.js';

/** 集約の章 1 本の材料。 */
export interface DomainEnv {
  readonly model: SpecModel;
  readonly ctx: GenerateContext;
  readonly facts: FaceFacts;
  /** 章の構成(どの集約がどの章に載るか)。 */
  readonly layout: BookLayout;
  /** 書き出すファイル(リポジトリルート相対。出典へのリンクの起点)。 */
  readonly pageFile: string;
  /** 章の数の鍵(章のファイル。標識を章に配る単位と、レビューの手引きの数が使う)。 */
  readonly countKey: string;
  /** 語釈の引き先(台帳)。 */
  readonly glossary: Glossary;
  /** ロール id → 日本語名(名前の無いロールは持たない)。 */
  readonly roleName: ReadonlyMap<string, string>;
  /** 状態機械 1 本の流れの事実(新しい形の章と同じ事実。図を描く)。 */
  readonly lifecycle: (aggregate: string, machine: string) => LifecycleFacts | undefined;
}

/** 材料を組む。 */
export function domainEnv(
  model: SpecModel,
  ctx: GenerateContext,
  facts: FaceFacts,
  layout: BookLayout,
  pageFile: string,
  countKey: string,
  glossary: Glossary,
  lifecycle: DomainEnv['lifecycle'],
): DomainEnv {
  return { model, ctx, facts, layout, pageFile, countKey, glossary, roleName: roleLabels(model), lifecycle };
}

/**
 * 集約の内容が載る章への URL(同じ `domain/` の中の相対)。畳んだ従属する集約は、親の章の先頭でなく、その節のアンカー付き。
 * `chapterHref`(`face-scope.ts`)と同じ規則で、拡張子だけが `.html` である。
 *
 * @param prefix 呼ぶページから `domain/` への相対(同じ `domain/` の中なら `./`、`spec/` からなら `../domain/`)
 */
export function domainHref(layout: BookLayout, name: string, prefix = './'): string {
  const folded = layout.nested && layout.ownership.owned.has(name);
  return `${prefix}${layout.chapterOf(name)}.html${folded ? `#${sectionAnchor(name)}` : ''}`;
}

/** 集約の新しい形の章(`spec/{集約}.html`)への URL(`domain/` から見た相対)。 */
export function specHref(name: string): string {
  return `../spec/${name}.html`;
}

/** 日本語名の無いロールは内部名の字のまま。 */
export function roleWord(env: DomainEnv, role: string): string {
  return env.roleName.get(role) ?? role;
}

/** 章の中のリンク。 */
export function link(href: string, ...kids: readonly Child[]): Html {
  return el('a', { href: url(href) }, kids);
}
