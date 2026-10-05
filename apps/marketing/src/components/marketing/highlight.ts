/**
 * Reckon marketing — tiny dependency-free syntax highlighter.
 *
 * Scope: highlighting ONLY the three fixed marketing snippets (cURL,
 * TypeScript, JSON) — not a general-purpose tokenizer. Sticks to a sticky-
 * regex scanner (~90 lines): each language declares ordered rules, the
 * first match at the cursor wins, unmatched chars fall through as plain
 * text. Output is a list of token lines rendered as React spans — no
 * dangerouslySetInnerHTML, so nothing needs HTML escaping.
 */

export type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "property"
  | "punct"
  | "flag"
  | "const";

export type Token = { text: string; kind: TokenKind };

/** Token[][] — one array of tokens per source line. */
export type TokenLines = Token[][];

interface Rule {
  kind: TokenKind;
  re: RegExp;
}

function sticky(source: string | RegExp, flags = ""): RegExp {
  // Accept a RegExp literal (test fixtures and rule tables pass regexes) or
  // a string source; either way compile to a sticky regex for the lexer.
  const text = source instanceof RegExp ? source.source : source;
  const inherited = source instanceof RegExp ? source.flags.replace("y", "") : "";
  return new RegExp(text, (flags || inherited) + "y");
}

function lex(source: string, rules: Rule[]): TokenLines {
  const lines: TokenLines = [[]];
  let pos = 0;
  outer: while (pos < source.length) {
    for (const rule of rules) {
      rule.re.lastIndex = pos;
      const match = rule.re.exec(source);
      if (match && match[0].length > 0) {
        const parts = match[0].split("\n");
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) lines.push([]);
          if (parts[i]) {
            lines[lines.length - 1].push({ text: parts[i], kind: rule.kind });
          }
        }
        pos += match[0].length;
        continue outer;
      }
    }
    const ch = source[pos];
    if (ch === "\n") {
      lines.push([]);
    } else {
      lines[lines.length - 1].push({ text: ch, kind: "plain" });
    }
    pos++;
  }
  return lines;
}

const wsRule: Rule = { kind: "plain", re: sticky(/[ \t]+/) };
const tsCommentRule: Rule = { kind: "comment", re: sticky(/\/\/[^\n]*/) };
const jsonKeyRule: Rule = { kind: "property", re: sticky(/"(?:[^"\\\n]|\\.)*"(?=[ \t]*:)/) };
const dblStringRule: Rule = { kind: "string", re: sticky(/"(?:[^"\\\n]|\\.)*"/) };
const numberRule: Rule = { kind: "number", re: sticky(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/) };

/** JSON — object keys, strings, numbers, literals, punctuation. */
const jsonRules: Rule[] = [
  wsRule,
  jsonKeyRule,
  dblStringRule,
  numberRule,
  { kind: "keyword", re: sticky(/\b(?:true|false|null)\b/) },
  { kind: "punct", re: sticky(/[{}[\],:]/) },
];

/**
 * cURL — the -d payload is single-quoted JSON, so the single-quote string
 * rule is deliberately ABSENT: the quotes lex as punctuation and the JSON
 * body inside keeps its own colors (keys, strings, numbers).
 */
const curlRules: Rule[] = [
  wsRule,
  tsCommentRule,
  { kind: "keyword", re: sticky(/\bcurl\b/) },
  { kind: "flag", re: sticky(/--[a-zA-Z][\w-]*/) },
  { kind: "const", re: sticky(/https?:\/\/[^\s'"]+/) },
  { kind: "string", re: sticky(/"(?:[^"\\\n]|\\.)*"/) },
  numberRule,
  { kind: "punct", re: sticky(/[{}[\],:'\\]/) },
  { kind: "plain", re: sticky(/[A-Za-z_][\w.-]*/) },
];

/** TypeScript — keywords, strings, package paths, env vars, properties. */
const tsRules: Rule[] = [
  wsRule,
  tsCommentRule,
  { kind: "string", re: sticky(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/) },
  {
    kind: "keyword",
    re: sticky(/\b(?:import|from|export|const|let|await|async|new|return|function|type)\b/),
  },
  { kind: "const", re: sticky(/@[a-z][\w-]*\/[a-z][\w-]*/) },
  { kind: "const", re: sticky(/\b[A-Z][A-Z0-9_]{2,}\b/) },
  { kind: "property", re: sticky(/(?<=\.)[A-Za-z_$][\w$]*/) },
  numberRule,
  { kind: "punct", re: sticky(/[{}[\]()<>,;:.!=?&|+\-*/]/) },
  { kind: "plain", re: sticky(/[A-Za-z_$][\w$]*/) },
];

export function tokenizeCurl(code: string): TokenLines {
  return lex(code, curlRules);
}

export function tokenizeTypeScript(code: string): TokenLines {
  return lex(code, tsRules);
}

export function tokenizeJson(code: string): TokenLines {
  return lex(code, jsonRules);
}

export type LanguageId = "curl" | "typescript" | "json";

export const tokenizers: Record<LanguageId, (code: string) => TokenLines> = {
  curl: tokenizeCurl,
  typescript: tokenizeTypeScript,
  json: tokenizeJson,
};
