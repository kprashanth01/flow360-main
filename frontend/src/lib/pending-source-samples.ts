import type { SourceCollection, SourceEntry } from "./types";

export type PendingSourceSample = SourceEntry & {
  ingest_hint: string;
};

export const pendingSourceSamples: Record<string, Partial<Record<SourceCollection, PendingSourceSample[]>>> = {};
