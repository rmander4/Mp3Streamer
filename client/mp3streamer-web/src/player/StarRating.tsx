const STAR_PATH =
  'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';

const STARS = [1, 2, 3, 4, 5];

interface StarRatingProps {
  rating: number;
  onRate: (stars: number) => void;
  size?: number;
}

export function StarRating({ rating, onRate, size = 26 }: StarRatingProps) {
  return (
    <div className="star-rating">
      {STARS.map((star) => {
        const filled = star <= rating;
        return (
          <button
            key={star}
            className="star-button"
            onClick={() => onRate(star)}
            aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
            aria-pressed={filled}
          >
            <svg viewBox="0 0 24 24" width={size} height={size}>
              <path
                d={STAR_PATH}
                fill={filled ? 'var(--text-h)' : 'none'}
                stroke={filled ? 'var(--text-h)' : 'var(--border)'}
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
