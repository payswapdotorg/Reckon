import { RichText } from "./rich-text.js";

/**
 * Reference table: first column rendered as a row header (field names),
 * cells support the RichText inline convention.
 */
export function DocsTable({
  columns,
  rows,
  caption,
}: {
  columns: readonly string[];
  rows: readonly (readonly string[])[];
  caption?: string;
}) {
  return (
    <div className="docs-table-wrap">
      <table className="docs-table">
        {caption !== undefined && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={cellIndex} scope="row" className="docs-table-key">
                    <RichText text={cell} />
                  </th>
                ) : (
                  <td key={cellIndex}>
                    <RichText text={cell} />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
