/**
 * Typed content model for the docs portal (S1-004).
 *
 * Docs content lives in typed data structures rendered by small
 * components — no markdown runtime, no MDX. Prose strings support a tiny
 * inline convention rendered by <RichText>: `code`, **bold** and
 * [label](/internal-or-external-link).
 */

import type { CodeLanguage } from "../lib/highlight.js";

/** A runnable, copyable code sample. */
export interface CodeSample {
  readonly language: CodeLanguage;
  /** Label shown in the block header (filename, "Request", "Response", …). */
  readonly label?: string;
  readonly code: string;
  /** Caption rendered under the block. */
  readonly caption?: string;
}

/** Lifecycle status of a documented surface (honest-degradation law). */
export type SurfaceStatus = "live" | "target";

/** One page reference in the sidebar IA. */
export interface DocsPageRef {
  readonly id: string;
  readonly title: string;
  /** App-router path beginning with "/". */
  readonly path: string;
  readonly description: string;
  readonly status?: SurfaceStatus;
}

/** One collapsible sidebar section. */
export interface DocsSection {
  readonly id: string;
  readonly title: string;
  readonly pages: readonly DocsPageRef[];
}

/** Right-hand "On this page" entry. */
export interface TocEntry {
  readonly id: string;
  readonly label: string;
  readonly level: 2 | 3;
}

/** Integration-option tab for the quickstart (Stripe-style). */
export interface IntegrationTab {
  readonly id: string;
  readonly label: string;
  readonly tagline: string;
  readonly samples: readonly CodeSample[];
}

/** One numbered quickstart step. */
export interface QuickstartStep {
  readonly id: string;
  readonly title: string;
  readonly minutes: string;
  readonly intro: readonly string[];
  readonly tabs?: readonly IntegrationTab[];
  readonly extra?: readonly CodeSample[];
}

/** One core-concept entry (the Reckon vertical). */
export interface ConceptEntry {
  readonly id: string;
  readonly term: string;
  readonly tagline: string;
  /** Frozen contract that formalizes this concept, when one exists. */
  readonly contract?: {
    readonly id: string;
    readonly version: string;
  };
  readonly summary: readonly string[];
  /** Field rows as [field, type, meaning] — rendered by DocsTable. */
  readonly fields?: readonly (readonly string[])[];
  readonly example?: {
    readonly caption: string;
    readonly json: string;
  };
}

/** An API endpoint row. */
export interface EndpointSpec {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly summary: string;
}

/** One typed error class in the error catalog. */
export interface ErrorClassEntry {
  readonly id: string;
  readonly name: string;
  readonly http: string;
  readonly description: string;
  readonly retryable: boolean;
  readonly codes: readonly {
    readonly code: string;
    readonly http: number;
    readonly meaning: string;
  }[];
}

/** One webhook event in the catalog (TARGET contract; S2-002 implements). */
export interface WebhookEventEntry {
  readonly id: string;
  readonly when: string;
  readonly description: readonly string[];
  readonly payload: string;
}
