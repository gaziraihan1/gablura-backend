export const ratingUserSelect = {
  id: true,
  name: true,
  image: true,
} as const;

export const ratingFullInclude = {
  user: { select: ratingUserSelect },
} as const;
