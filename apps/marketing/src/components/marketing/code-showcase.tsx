"use client";

/**
 * Code-first marketing artifact (survey §2.7): a real, copyable API call
 * rendered as a first-class section — cURL + TypeScript tabs, syntax
 * highlighted by the tiny in-repo tokenizer (no heavy deps), and the
 * DecisionResult response shaped by @reckon/contracts.
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

type TabId = "curl" | "typescript";

interface CodeTab {
  id: TabId;
  label: string;
  code: string;
  lines: TokenLines;
}

const codeTabs: CodeTab[] = [
  { id: "curl", label: "cURL", code: curlSnippet, lines: tokenizeCurl(curlSnippet) },
  {
    id: "typescript",
    label: "TypeScript",
    code: typescriptSnippet,
    lines: tokenizeTypeScript(typescriptSnippet),
  },
];

const responseLines: TokenLines = tokenizeJson(responseSnippet);

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

export function CodeShowcase() {
  const [active, setActive] = useState<TabId>("curl");
  const copiedRef = useRef<HTMLParagraphElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeTab = codeTabs.find((tab) => tab.id === active) ?? codeTabs[0];

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
    <section className="rk-section rk-section-code" id="get-started" aria-labelledby="rk-code-title">
      <div className="rk-container">
        <div id="rk-code-title" className="rk-sr-only">
          Code
        </div>
        <SectionHeading
          eyebrow={codeSection.eyebrow}
          title={codeSection.title}
          sub={codeSection.sub}
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
                  id={`rk-tab-${tab.id}`}
                  aria-selected={active === tab.id}
                  aria-controls="rk-code-panel-content"
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
            id="rk-code-panel-content"
            role="tabpanel"
            aria-labelledby={`rk-tab-${active}`}
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
            <span className="rk-code-response-label">{codeSection.responseLabel}</span>
            <CopyButton code={responseSnippet} label="response JSON" onCopied={() => undefined} />
          </div>
          <pre className="rk-code-pre rk-code-pre-response">
            <code className="rk-code">
              <CodeBlock lines={responseLines} />
            </code>
          </pre>
        </div>

        <ul className="rk-craft-notes" aria-label="API craft guarantees">
          {codeSection.craftNotes.map((note) => (
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
