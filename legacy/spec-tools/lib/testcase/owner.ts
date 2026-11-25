/**
 * 台帳のエントリの持ち主(製品か仕組みか)。
 *
 * 保証台帳は 2 本ある —— 製品のもの(`specs/backend/guarantees.md`)と、仕組みが自分自身について持つもの
 * (`framework/guarantees.md`)。テストケース ID の台帳は 1 本のまま両方を載せ(A9 が台帳をまたぐ重複を拾う)、
 * 仕組みの側のエントリにだけ `owner: 'framework'` を付ける。**付いていなければ製品**である。
 *
 * `TcRegistryEntry` の型そのものには欄を足さない(C24 の写し元の閉包に入る葉で、触ると RPC のモデルの hash が動く)。
 * 構造的に上位の型として足し、読む口はこのファイルの `ownerOf` 1 本にする。
 */

import type { LedgerOwner } from '../kernel/ledger-owner.js';
import type { TcRegistryEntry } from './types.js';

export type { LedgerOwner };

/** 持ち主つきの台帳エントリ(仕組みの台帳の写し取りが作る)。 */
export interface OwnedTcRegistryEntry extends TcRegistryEntry {
  readonly owner: LedgerOwner;
}

/**
 * エントリの持ち主。
 *
 * @param entry 台帳のエントリ
 * @returns `owner` が仕組みなら 'framework'、それ以外(欄が無い)は 'product'
 */
export function ownerOf(entry: TcRegistryEntry): LedgerOwner {
  return 'owner' in entry && entry.owner === 'framework' ? 'framework' : 'product';
}
