export function Caveat({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="la-caveat">
      <div className="la-caveat-title">
        <span className="la-caveat-mark" />
        Caveats
      </div>
      <ul>
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}
