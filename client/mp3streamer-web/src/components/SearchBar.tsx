import { useEffect, useState } from 'react';

interface SearchBarProps {
  onSearch: (term: string) => void;
  placeholder?: string;
}

export function SearchBar({ onSearch, placeholder }: SearchBarProps) {
  const [value, setValue] = useState('');

  useEffect(() => {
    const handle = setTimeout(() => onSearch(value), 300);
    return () => clearTimeout(handle);
  }, [value, onSearch]);

  return (
    <input
      className="search-bar"
      type="text"
      value={value}
      placeholder={placeholder ?? 'Search title, artist, album...'}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
