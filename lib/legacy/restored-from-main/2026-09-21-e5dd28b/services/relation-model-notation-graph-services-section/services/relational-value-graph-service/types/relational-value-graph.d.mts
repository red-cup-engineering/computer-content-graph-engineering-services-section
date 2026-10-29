import type { Tm, Ty } from "@red-cup-engineering/relation-model-notation/types";

export type { Tm, Ty } from "@red-cup-engineering/relation-model-notation/types";
export type RmnTerm = Tm;
export type RmnType = Ty;

export interface RelationalValueEncoding {
  readonly type: RmnType;
  readonly term: RmnTerm;
}

export interface RelationalValueClaim {
  readonly semanticType: RmnType;
  readonly term: RmnTerm;
}

export interface RelationalValuePayload {
  readonly bytes: Buffer;
  readonly token: string;
  readonly claim: RelationalValueClaim;
}

export const RELATIONAL_VALUE_TYPE: RmnType;
export function encodeRelationalValue(source: unknown): RelationalValueEncoding;
export function decodeRelationalValue(type: unknown, term: unknown): unknown;
export function relationalValueId(source: unknown): string;
export function identifyRelationalValuePayload(source: unknown): RelationalValuePayload;
export function admitRelationalValuePayload(payload: {
  readonly bytes: Uint8Array;
  readonly token: string;
}): RelationalValuePayload;
export function verifyRelationalValuePayload(payload: {
  readonly token: string;
  readonly claim: RelationalValueClaim;
}): boolean;
