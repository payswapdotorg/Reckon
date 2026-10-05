/**
 * Mini syntax highlighter for the docs portal (S1-004).
 *
 * A small, dependency-free tokenizer for the five languages the docs use
 * (bash, json, typescript, python, sse). It emits typed tokens that React
 * renders as <span> elements — never HTML strings, so nothing is injected.
 *
 * Rules kept deliberately simple: samples in `src/content` are controlled
 * input, so a scanner built from ordered sticky regexes is enough — no
 * parser, no heavy highlighting dependency.
 */

export type CodeLanguage = "bash" | "json" | "typescript" | "python" | "sse" | "text";

export type TokenType =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "boolean"
  | "property"
  | "function"
  | "type"
  | "variable"
  | "operator"
  | "punctuation"
  | "field";

export interface Token {
  readonly type: TokenType;
  readonly value: string;
}

/** Tokenize `code` for the given language. Always returns tokens covering
 *  the entire input (unknown characters fall through as "plain"). */
export function tokenize(code: string, language: CodeLanguage): Token[] {
  switch (language) {
    case "json":
      return tokenizeJson(code);
    case "bash":
      return tokenizeBash(code);
    case "typescript":
      return tokenizeClike(code, "typescript");
    case "python":
      return tokenizeClike(code, "python");
    case "sse":
      return tokenizeSse(code);
    case "text":
      return [{ type: "plain", value: code }];
  }
}

/* ------------------------------------------------------------------ *
 * Scanner
 * ------------------------------------------------------------------ */

class Scanner {
  pos = 0;
  readonly tokens: Token[] = [];
  /** Last non-whitespace token emitted (for position-sensitive choices). */
  lastSignificant: Token | undefined = undefined;

  constructor(readonly src: string) {}

  get done(): boolean {
    return this.pos >= this.src.length;
  }

  /** Try a sticky regex at the cursor; on match emit tokens and advance. */
  match(re: RegExp, type: TokenType, valueOverride?: string): boolean {
    re.lastIndex = this.pos;
    const m = re.exec(this.src);
    if (m === null) return false;
    this.emit(type, valueOverride ?? m[0]);
    this.pos += m[0].length;
    return true;
  }

  /** Try a sticky regex whose FIRST capture group is the token value. */
  matchCapture(re: RegExp, type: TokenType): boolean {
    re.lastIndex = this.pos;
    const m = re.exec(this.src);
    if (m === null || m[1] === undefined) return false;
    this.emit(type, m[1]);
    this.pos += m[0].length;
    return true;
  }

  /** Try a sticky regex; on match, run `onMatch` which emits tokens. */
  tryRule(re: RegExp, onMatch: (m: RegExpExecArray) => void): boolean {
    re.lastIndex = this.pos;
    const m = re.exec(this.src);
    if (m === null) return false;
    onMatch(m);
    this.pos += m[0].length;
    return true;
  }

  emit(type: TokenType, value: string): void {
    if (value.length === 0) return;
    const token: Token = { type, value };
    this.tokens.push(token);
    if (type !== "plain") this.lastSignificant = token;
  }

  /** Consume one character as plain text (safety net). */
  fallback(): void {
    // Consume a run of characters that no rule matched.
    const ch = this.src[this.pos];
    if (ch === undefined) return;
    this.emit("plain", ch);
    this.pos += 1;
  }
}

/* ------------------------------------------------------------------ *
 * JSON
 * ------------------------------------------------------------------ */

const JSON_WS = /\s+/y;
const JSON_KEY = /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y;
const JSON_STRING = /"(?:[^"\\\n]|\\.)*"/y;
const JSON_NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const JSON_BOOLEAN = /\b(?:true|false|null)\b/y;
const JSON_PUNCT = /[{}[\],:]/y;

function tokenizeJson(code: string): Token[] {
  const s = new Scanner(code);
  while (!s.done) {
    if (s.match(JSON_WS, "plain")) continue;
    if (s.match(JSON_KEY, "property")) continue;
    if (s.match(JSON_STRING, "string")) continue;
    if (s.match(JSON_NUMBER, "number")) continue;
    if (s.match(JSON_BOOLEAN, "boolean")) continue;
    if (s.match(JSON_PUNCT, "punctuation")) continue;
    s.fallback();
  }
  return s.tokens;
}

/* ------------------------------------------------------------------ *
 * Bash
 * ------------------------------------------------------------------ */

const BASH_WS = /\s+/y;
const BASH_COMMENT = /#[^\n]*/y;
const BASH_URL = /https?:\/\/[^\s'"\\]+/y;
const BASH_DSTR = /"(?:[^"\\]|\\.)*"/y;
const BASH_SSTR = /'[^']*'/y;
const BASH_VAR = /\$\{[^}\n]+\}|\$[A-Za-z_][A-Za-z0-9_]*/y;
const BASH_FLAG = /-{1,2}[A-Za-z][A-Za-z0-9-]*/y;
const BASH_NUMBER = /\b\d+(?:\.\d+)?\b/y;
const BASH_KEYWORD =
  /\b(?:export|if|then|elif|else|fi|for|while|until|do|done|in|function|return|local|set|source|sudo|cd)\b/y;
const BASH_WORD = /[A-Za-z_][A-Za-z0-9_.-]*/y;
const BASH_OPERATOR = /&&|\|\||[=<>|&]+/y;
const BASH_PUNCT = /[(){}[\];,]/y;

const BASH_COMMANDS = new Set([
  "curl", "node", "npm", "npx", "pnpm", "bun", "bunx", "python", "python3",
  "pip", "pip3", "echo", "printf", "jq", "docker", "git", "tsc", "vitest",
  "openssl", "uname", "cat", "mkdir", "cp", "mv", "grep", "sed", "awk",
]);

function tokenizeBash(code: string): Token[] {
  const s = new Scanner(code);
  while (!s.done) {
    if (s.match(BASH_WS, "plain")) continue;
    if (s.match(BASH_COMMENT, "comment")) continue;
    if (s.match(BASH_URL, "string")) continue;
    if (s.match(BASH_DSTR, "string")) continue;
    if (s.match(BASH_SSTR, "string")) continue;
    if (s.match(BASH_VAR, "variable")) continue;
    if (s.match(BASH_FLAG, "keyword")) continue;
    if (s.match(BASH_NUMBER, "number")) continue;
    if (s.match(BASH_KEYWORD, "keyword")) continue;
    if (s.tryRule(BASH_WORD, (m) => {
      const word = m[0] ?? "";
      const nextChar = s.src[s.pos + word.length];
      const last = s.lastSignificant;
      const atCommandPosition =
        last === undefined ||
        (last.type === "punctuation" && (last.value === "|" || last.value === ";")) ||
        (last.type === "operator" && (last.value === "|" || last.value === "&&" || last.value === "||")) ||
        (last.type === "keyword" && (last.value === "then" || last.value === "do" || last.value === "else" || last.value === "fi" || last.value === "done"));
      if (nextChar === "=") {
        s.emit("variable", word);
        return;
      }
      if (atCommandPosition && BASH_COMMANDS.has(word)) {
        s.emit("function", word);
        return;
      }
      s.emit("plain", word);
    })) {
      continue;
    }
    if (s.match(BASH_OPERATOR, "operator")) continue;
    if (s.match(BASH_PUNCT, "punctuation")) continue;
    s.fallback();
  }
  return s.tokens;
}

/* ------------------------------------------------------------------ *
 * TypeScript / Python (shared identifier-classifying scanner)
 * ------------------------------------------------------------------ */

const TS_COMMENT_LINE = /\/\/[^\n]*/y;
const TS_COMMENT_BLOCK = /\/\*[\s\S]*?\*\//y;
const TEMPLATE_STRING = /`(?:[^`\\]|\\.)*`/y;
const TS_DSTR = /"(?:[^"\\\n]|\\.)*"/y;
const TS_SSTR = /'(?:[^'\\\n]|\\.)*'/y;
const TS_NUMBER = /\b0x[\da-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y;
const TS_BOOLEAN = /\b(?:true|false|null|undefined)\b/y;
const TS_KEYWORD =
  /\b(?:abstract|as|async|await|break|case|catch|class|const|continue|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|keyof|let|namespace|new|of|override|private|protected|public|readonly|return|satisfies|set|static|super|switch|this|throw|try|type|typeof|var|void|while|yield)\b/y;
const TS_TYPES = new Set(["string", "number", "boolean", "object", "any", "unknown", "never", "symbol", "bigint"]);
const TS_DECORATOR = /@[A-Za-z_][\w.]*/y;
const TS_IDENT = /[A-Za-z_$][\w$]*/y;
const TS_OPERATOR = /=>|\?\?|\.\.\.|[+\-*/%=!<>&|^~?:]+/y;
const TS_PUNCT = /[{}()[\];,.]/y;

const PY_COMMENT = /#[^\n]*/y;
const PY_STRING =
  /[fFrRbBuU]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/y;
const PY_NUMBER = /\b0[xXbBoO][\da-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y;
const PY_BOOLEAN = /\b(?:True|False|None)\b/y;
const PY_KEYWORD =
  /\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|match|case)\b/y;
const PY_DECORATOR = /@[A-Za-z_][\w.]*/y;
const PY_IDENT = /[A-Za-z_][\w]*/y;
const PY_OPERATOR = /:=|\*\*|\/\/|[+\-*/%=!<>&|^~]+/y;
const PY_PUNCT = /[{}()[\];,.:]/y;

function tokenizeClike(code: string, language: "typescript" | "python"): Token[] {
  const s = new Scanner(code);
  const isTs = language === "typescript";
  while (!s.done) {
    if (isTs) {
      if (s.match(TS_COMMENT_LINE, "comment")) continue;
      if (s.match(TS_COMMENT_BLOCK, "comment")) continue;
    } else {
      if (s.match(PY_COMMENT, "comment")) continue;
    }
    if (s.match(/\s+/y, "plain")) continue;
    if (isTs && s.match(TEMPLATE_STRING, "string")) continue;
    if (s.match(isTs ? TS_DSTR : PY_STRING, "string")) continue;
    if (isTs && s.match(TS_SSTR, "string")) continue;
    if (s.match(isTs ? TS_NUMBER : PY_NUMBER, "number")) continue;
    if (s.match(isTs ? TS_BOOLEAN : PY_BOOLEAN, "boolean")) continue;
    if (s.match(isTs ? TS_KEYWORD : PY_KEYWORD, "keyword")) continue;
    if (s.match(isTs ? TS_DECORATOR : PY_DECORATOR, "keyword")) continue;
    if (s.tryRule(isTs ? TS_IDENT : PY_IDENT, (m) => {
      const word = m[0] ?? "";
      const nextChar = s.src[s.pos + word.length];
      const last = s.lastSignificant;
      if (isTs && TS_TYPES.has(word)) {
        s.emit("type", word);
        return;
      }
      if (nextChar === "(") {
        s.emit("function", word);
        return;
      }
      if (last !== undefined && last.value === "." && last.type === "punctuation") {
        s.emit("property", word);
        return;
      }
      if (/^[A-Z]/.test(word)) {
        s.emit("type", word);
        return;
      }
      s.emit("variable", word);
    })) {
      continue;
    }
    if (s.match(isTs ? TS_OPERATOR : PY_OPERATOR, "operator")) continue;
    if (s.match(isTs ? TS_PUNCT : PY_PUNCT, "punctuation")) continue;
    s.fallback();
  }
  return s.tokens;
}

/* ------------------------------------------------------------------ *
 * SSE wire format (text/event-stream)
 * ------------------------------------------------------------------ */

const SSE_FIELD = /([A-Za-z-]+):/y;

function tokenizeSse(code: string): Token[] {
  const tokens: Token[] = [];
  const lines = code.split("\n");
  lines.forEach((line, index) => {
    if (line.length > 0) {
      if (line.startsWith(":")) {
        tokens.push({ type: "comment", value: line });
      } else {
        SSE_FIELD.lastIndex = 0;
        const m = SSE_FIELD.exec(line);
        const field = m?.[1];
        if (m !== null && field !== undefined) {
          tokens.push({ type: "keyword", value: m[0] });
          const rest = line.slice(m[0].length);
          if (rest.length > 0) {
            if (field === "data" && rest.trimStart().startsWith("{")) {
              tokens.push({ type: "plain", value: rest.slice(0, rest.indexOf("{")) });
              tokens.push(...tokenizeJson(rest.slice(rest.indexOf("{"))));
            } else {
              tokens.push({ type: "string", value: rest });
            }
          }
        } else {
          tokens.push({ type: "plain", value: line });
        }
      }
    }
    if (index < lines.length - 1) {
      tokens.push({ type: "plain", value: "\n" });
    }
  });
  return tokens;
}
