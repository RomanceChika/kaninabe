/**
 * 台帳(保証台帳・テストケース ID の台帳のエントリ)の持ち主。
 *
 * 保証台帳は 2 本ある —— 製品のもの(`specs/backend/guarantees.md`)と、仕組みが自分自身について持つもの(`framework/guarantees.md`)。
 * 前段(台帳を読む側)も検査(台帳を引く側)も同じ語を使うので、どの層も読める土台に置く。
 */

/** 台帳の持ち主(製品か仕組みか)。 */
export type LedgerOwner = 'product' | 'framework';
