/**
 * Endpoint row: HTTP method chip + path. The method chip is color-coded
 * (POST filled brand accent, GET outlined) like premium API references.
 */
export function Endpoint({ method, path }: { method: "GET" | "POST"; path: string }) {
  return (
    <div className="endpoint">
      <span className="endpoint-method" data-method={method}>
        {method}
      </span>
      <code className="endpoint-path">{path}</code>
    </div>
  );
}
