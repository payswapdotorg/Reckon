"use client";

/**
 * Code-first marketing artifact (survey §2.7): a real, copyable API call
 * rendered as a first-class section — cURL + TypeScript tabs, syntax
 * highlighted by the tiny in-repo tokenizer (no heavy deps), and the
 * contract-shaped JSON response.
 *
 * S1-002: the showcase is parameterized — the home renders its default
 * artifact (the POST /v1/decisions pair from marketing-content.ts, byte
 * for byte as in S1-001), while each product page passes its own
 * artifact from product-content.ts. One component, one design system.
 *
 * A11y: ARIA tabs pattern (roving tabindex, arrow keys, aria-selected),
 * clipboard feedback announced via a polite live region, copy buttons
 * keep 44px targets.
 */
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { CheckIcon, CopyIcon } from "@/components/marketing/icons";
import {
  tokenizeCurl,
  tokenizeJson,
  tokenizeTypeScript,
  type TokenLines,
} from "@/components/marketing/highlight";
import { CtaRow } from "@/components/marketing/cta-row";
import { SectionHeading } from "@/components/marketing/section-heading";
import {
  codeSection,
  curlSnippet,
  responseSnippet,
  typescriptSnippet,
} from "@/lib/marketing-content";
import type { ProductCodeArtifact } from "@/lib/product-content";

type TabId = string;

interface CodeTab {
  id: TabId;
  label: string;
  language: "curl" | "typescript";
  code: string;
  lines: TokenLines;
}

/** Build the highlighted tab model from an artifact's raw tabs. */
function buildTabs(artifact: ProductCodeArtifact): CodeTab[] {
  return artifact.tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    language: tab.language,
    code: tab.code,
    lines:
      tab.language === "curl"
        ? tokenizeCurl(tab.code)
        : tokenizeTypeScript(tab.code),
  }));
}

/** The home's default artifact (S1-001, unchanged). */
const homeArtifact: ProductCodeArtifact = {
  eyebrow: codeSection.eyebrow,
  title: codeSection.title,
  sub: codeSection.sub,
  tabs: [
    { id: "curl", label: "cURL", language: "curl", code: curlSnippet },
    {
      id: "typescript",
      label: "TypeScript",
      language: "typescript",
      code: typescriptSnippet,
    },
  ],
  responseLabel: codeSection.responseLabel,
  response: responseSnippet,
  craftNotes: [...codeSection.craftNotes],
};

function CodeBlock({ lines }: { lines: TokenLines }) {
  return (
    <>
      {lines.map((tokens, index) => (
        <span className="rk-code-line" key={index}>
          {tokens.length === 0
            ? "\u00A0"
            : tokens.map((token, i) =>
                token.kind === "plain" ? (
                  <span key={i}>{token.text}</span>
                ) : (
                  <span className={`rk-tok-${token.kind}`} key={i}>
                    {token.text}
                  </span>
                ),
              )}
        </span>
      ))}
    </>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({
  code,
  label,
  onCopied,
}: {
  code: string;
  label: string;
  onCopied: (key: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rk-copy-btn"
      aria-label={`Copy ${label} to clipboard`}
      onClick={async () => {
        const ok = await copyText(code);
        if (ok) {
          setCopied(true);
          onCopied(label);
          window.setTimeout(() => setCopied(false), 2000);
        }
      }}
    >
      {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

interface CodeShowcaseProps {
  /** Product pages pass their artifact; the home keeps its default. */
  artifact?: ProductCodeArtifact;
  /** Distinguishes ARIA ids when a page mounts a non-default panel; the default keeps the S1-001 ids. */
  panelId?: string;
  /** Section anchor id — the home's is #get-started (S1-001); product pages pass their own. */
  sectionId?: string;
}

export function CodeShowcase({ artifact = homeArtifact, panelId, sectionId }: CodeShowcaseProps) {
  const [active, setActive] = useState<TabId>(artifact.tabs[0]?.id ?? "curl");
  const copiedRef = useRef<HTMLParagraphElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const codeTabs = buildTabs(artifact);
  const activeTab = codeTabs.find((tab) => tab.id === active) ?? codeTabs[0];
  const contentId = panelId ? `rk-code-${panelId}-content` : "rk-code-panel-content";
  const titleId = panelId ? `rk-code-${panelId}-title` : "rk-code-title";
  const tabId = (id: TabId) => (panelId ? `rk-tab-${panelId}-${id}` : `rk-tab-${id}`);

  const selectTab = (index: number) => {
    const tab = codeTabs[index];
    if (!tab) return;
    setActive(tab.id);
    tabRefs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = codeTabs.findIndex((tab) => tab.id === active);
    let next = -1;
    if (event.key === "ArrowRight") next = (currentIndex + 1) % codeTabs.length;
    else if (event.key === "ArrowLeft") next = (currentIndex - 1 + codeTabs.length) % codeTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = codeTabs.length - 1;
    if (next >= 0) {
      event.preventDefault();
      selectTab(next);
    }
  };

  return (
    <section
      className="rk-section rk-section-code"
      id={sectionId ?? "get-started"}
      aria-labelledby={titleId}
    >
      <div className="rk-container">
        <div id={titleId} className="rk-sr-only">
          Code
        </div>
        <SectionHeading
          eyebrow={artifact.eyebrow}
          title={artifact.title}
          sub={artifact.sub}
        />

        <div className="rk-code-panel">
          <div className="rk-code-panel-bar">
            <div className="rk-code-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div
              className="rk-code-tabs"
              role="tablist"
              aria-label="Code language"
              onKeyDown={onKeyDown}
            >
              {codeTabs.map((tab, index) => (
                <button
                  type="button"
                  key={tab.id}
                  role="tab"
                  id={tabId(tab.id)}
                  aria-selected={active === tab.id}
                  aria-controls={contentId}
                  tabIndex={active === tab.id ? 0 : -1}
                  className={active === tab.id ? "rk-code-tab rk-code-tab-active" : "rk-code-tab"}
                  onClick={() => selectTab(index)}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <CopyButton code={activeTab.code} label={`${activeTab.label} request`} onCopied={() => undefined} />
          </div>

          <div
            className="rk-code-body"
            id={contentId}
            role="tabpanel"
            aria-labelledby={tabId(active)}
            tabIndex={0}
          >
            <pre className="rk-code-pre">
              <code className="rk-code">
                <CodeBlock lines={activeTab.lines} />
              </code>
            </pre>
          </div>
        </div>

        <div className="rk-code-response">
          <div className="rk-code-response-bar">
            <span className="rk-code-response-label">{artifact.responseLabel}</span>
            <CopyButton code={artifact.response} label="response JSON" onCopied={() => undefined} />
          </div>
          <pre className="rk-code-pre rk-code-pre-response">
            <code className="rk-code">
              <CodeBlock lines={tokenizeJson(artifact.response)} />
            </code>
          </pre>
        </div>

        <ul className="rk-craft-notes" aria-label="API craft guarantees">
          {artifact.craftNotes.map((note) => (
            <li key={note}>
              <span className="rk-craft-dot" aria-hidden="true" />
              {note}
            </li>
          ))}
        </ul>

        <CtaRow compact />

        <p className="rk-sr-only" role="status" aria-live="polite" ref={copiedRef}>
          {/* Copy feedback is announced by the live region text below. */}
        </p>
      </div>
    </section>
  );
}
