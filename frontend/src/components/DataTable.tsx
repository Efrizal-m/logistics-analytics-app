import type { Row } from "../types";
import { titleCase } from "../format";

const MAX_ROWS = 200;

/** The rows behind an answer, so a number can always be checked by hand. */
export function DataTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="muted small">No rows.</p>;

  const columns = Object.keys(rows[0]);
  const visible = rows.slice(0, MAX_ROWS);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} className={isNumeric(rows, column) ? "numeric" : undefined}>
                {titleCase(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column} className={isNumeric(rows, column) ? "numeric" : undefined}>
                  {format(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > visible.length && (
        <p className="muted small">
          Showing {visible.length} of {rows.length} rows.
        </p>
      )}
    </div>
  );
}

function isNumeric(rows: Row[], column: string): boolean {
  return typeof rows[0][column] === "number";
}

function format(value: Row[string]): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(4);
  }
  return value;
}
