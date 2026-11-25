/**
 * 置き場の**入れ子・逆引きの衝突**の検査(`nestedPlaceProblems`)— ある役割の置き場が、別の役割の逆引きの走査の根の下に入り、その役割の逆引きに**自分の実体と読まれない**こと
 * (= 同じファイルを 2 つの役割が自分のものと読まない。§20-2 の「同じパスが 2 役割に分類されたら衝突」)。
 *
 * 逆引き(`classify`)を持つ役割は、走査の根の下のファイルを読んで「これは自分の実体のキーだ」と答える(余分の検出・通し実行の「拾う口」・S7 / J2・実装の走査が使う)。
 * 別の役割の置き場がその根の下に入ると、キーによっては**同じファイルを 2 つの役割が自分のものと数える**(例: ある役割のキーが走査の根のディレクトリ名と同じになって
 * 置き場がその下に入り、ファイル名の綴りまで逆引きに読まれる)。キーは仕様の名前(集約名・表名ほか)で、配置の定義の側からは分からないので、
 * **キーの形ごとの見本と、走査の根のディレクトリ名と同じキー**を試して、役割の置き場を全役割の逆引き(`layoutClassify`)に当て、自分以外の役割に読まれるかを見る。
 * 逆引きが読まなければ(ファイル名の綴りが違えば)入れ子でも取り違えは起きないので指さない。**同じ走査の根を共有する役割(画面の器と HTTP の入口)も、逆引きの判定が
 * 別のファイル名を読むので、取り違えない限り指さない**(設計上の共有。判定が重なれば指す)。
 *
 * 純関数で throw しない。**配置の定義の検査(`layout-definition.ts`)が呼ぶ**(解決と逆引きだけを読む)。
 */

import { layoutClassify } from './layout-classify.js';
import { LAYOUT_CLASSIFIED_ROLES, LAYOUT_ROLES, layoutPath, layoutScan } from './layout.js';
import type { ProductLayout } from './layout.js';

/** 走査の根のディレクトリ名 `segment` を取り込むキー(キーの形ごと。形に合わなければ null)。 */
function probeKey(shape: string, segment: string): string | null {
  if (shape === 'none') return '';
  if (shape === 'url_path') return `/${segment}`;
  if (shape === 'integration_id' || shape === 'file_name' || shape === 'spec_name') return segment;
  if (shape === 'operation_id' || shape === 'save_id') return `${segment}.probe`;
  return null;
}

/** 逆引きを持つ全役割の走査の根のディレクトリ名(リポジトリルート相対の区切りごと。重複なし)。 */
function scanSegments(layout: ProductLayout, except: string): string[] {
  const segments = new Set<string>();
  for (const role of LAYOUT_CLASSIFIED_ROLES) {
    if (role === except) continue;
    for (const segment of layoutScan(layout, '', role)?.dir.split('/') ?? []) segments.add(segment);
  }
  return [...segments];
}

/**
 * 入れ子・逆引きの衝突の違反を返す。
 *
 * @param layout 後段が与える配置
 * @param sampleKeys キーの形ごとのキーの見本(定義の検査と同じもの)
 * @returns 違反の説明(無ければ空)
 */
export function nestedPlaceProblems(layout: ProductLayout, sampleKeys: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  // 語彙に無い役割は、ここでは数えない(語彙に無いと別の検査が先に止める。逆引きの口も語彙の役割だけを読む)。
  for (const role of LAYOUT_ROLES) {
    const decl = layout[role];
    if (decl === undefined || decl.place === null) continue;
    const keys = new Set([sampleKeys[decl.multiplicity.key], ...scanSegments(layout, role).map((segment) => probeKey(decl.multiplicity.key, segment))]);
    const reported = new Set<string>();
    for (const key of keys) {
      if (key === undefined || key === null) continue;
      const path = layoutPath(layout, '', role, key);
      if (path === null) continue;
      for (const claim of layoutClassify(layout, '', path)) {
        if (claim.role === role || reported.has(claim.role)) continue;
        reported.add(claim.role);
        problems.push(
          `役割 ${role}: キー ${key === '' ? '(なし)' : key} の置き場 ${path} が、役割 ${claim.role} の走査の根 ${layoutScan(layout, '', claim.role)?.dir ?? ''} の下に入り、${claim.role} の逆引きに自分の実体として読まれます` +
            '(同じファイルを 2 つの役割が自分のものと数える — 置き場の綴りか走査の根を分ける)',
        );
      }
    }
  }
  return problems;
}
