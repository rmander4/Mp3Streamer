import type { Facet } from '../api/types';

interface FacetListProps {
  facets: Facet[];
  onSelect: (name: string) => void;
}

export function FacetList({ facets, onSelect }: FacetListProps) {
  if (facets.length === 0) {
    return <p className="empty-state">Nothing found.</p>;
  }

  return (
    <ul className="facet-list">
      {facets.map((f) => (
        <li key={f.name}>
          <button className="facet-item" onClick={() => onSelect(f.name)}>
            <span>{f.name}</span>
            <span className="facet-count">{f.trackCount}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
