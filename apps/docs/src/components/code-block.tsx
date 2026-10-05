"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tokenize } from "@/lib/highlight";
import type { CodeSample } from "@/content/types";
import { RichText } from "./rich-text.js";

/**
 * Runnable, copyable code sample: header with label + copy button, a
 * syntax-highlighted <pre> rendered from typed tokens (never HTML
 * strings), and an optional RichText caption.
 */

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path below
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

export function CodeBlock({ sample }: { sample: CodeSample }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tokens = useMemo(() => tokenize(sample.code, sample.language), [sample]);

  useEffect(() => {
    return () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    };
  }, []);

  const onCopy = useCallback(async () => {
    const ok = await writeClipboard(sample.code);
    if (ok) {
      setCopied(true);
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    }
  }, [sample]);

  return (
    <figure className="code-block">
      <div className="code-head">
        <span className="code-label">{sample.label ?? sample.language}</span>
        <button
          type="button"
          className="code-copy"
          data-copied={copied ? "true" : "false"}
          onClick={() => void onCopy()}
          aria-label={`Copy code sample${sample.label !== undefined ? ` (${sample.label})` : ""}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="code-pre" tabIndex={0}>
        <code className="code-code" data-lang={sample.language}>
          {tokens.map((token, index) => (
            <span key={index} className={`tk-${token.type}`}>
              {token.value}
            </span>
          ))}
        </code>
      </pre>
      {sample.caption !== undefined && (
        <figcaption className="code-caption">
          <RichText text={sample.caption} />
        </figcaption>
      )}
    </figure>
  );
}
