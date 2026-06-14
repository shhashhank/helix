import { type ReactElement } from 'react';

/** A simple stand-in page; each real screen replaces its route element in HELIX-176…179. */
export function Placeholder({ title, note }: { title: string; note?: string }): ReactElement {
  return (
    <section className="helix-placeholder">
      <h1>{title}</h1>
      <p>{note ?? 'Coming soon.'}</p>
    </section>
  );
}

export default Placeholder;
