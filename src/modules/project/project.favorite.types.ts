export interface CreateFavoriteDto {
  projectId:   string;
  userId:      string;
  group?:      string;
  sortOrder?:  number;
  note?:       string;
}

export interface UpdateFavoriteDto {
  group?:     string | null;
  sortOrder?: number;
  note?:      string | null;
}

export interface FavoriteGroup {
  group:    string;
  favorites: Array<{
    id:        string;
    projectId: string;
    sortOrder: number;
    note?:     string;
    createdAt: Date;
    project:   {
      id:    string;
      name:  string;
      slug:  string;
      color: string | null;
      status: string;
    };
  }>;
}
