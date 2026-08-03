import { TaskStatus } from '@prisma/client';

export type SectionStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED';

export interface CreateSectionDto {
  name:        string;
  description?: string;
  color?:       string;
  status?:      SectionStatus;
  position?:    number;
  wipLimit?:    number;
  taskStatus?:  TaskStatus;
  projectId:    string;
}

export interface UpdateSectionDto {
  name?:        string;
  description?: string;
  color?:       string;
  status?:      SectionStatus;
  position?:    number;
  wipLimit?:    number;
  // null explicitly clears the mapping (a section stops being a board column)
  taskStatus?:  TaskStatus | null;
}
