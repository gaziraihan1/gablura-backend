export type SectionStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED';

export interface CreateSectionDto {
  name:        string;
  description?: string;
  color?:       string;
  status?:      SectionStatus;
  position?:    number;
  projectId:    string;
}

export interface UpdateSectionDto {
  name?:        string;
  description?: string;
  color?:       string;
  status?:      SectionStatus;
  position?:    number;
}
