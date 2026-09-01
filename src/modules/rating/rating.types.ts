export interface CreateRatingInput {
  userId: string;
  stars: number;
  comment?: string | null;
}

export interface UpdateRatingInput {
  stars?: number;
  comment?: string | null;
}
