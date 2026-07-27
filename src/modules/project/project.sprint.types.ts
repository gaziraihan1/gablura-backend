export type SprintStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface CreateSprintDto {
  name:       string;
  goal?:       string;
  startDate:   Date;
  endDate:     Date;
  projectId:   string;
}

export interface UpdateSprintDto {
  name?:            string;
  goal?:            string;
  status?:          SprintStatus;
  startDate?:       Date;
  endDate?:         Date;
  retrospective?:   string;
  totalPoints?:     number;
  completedPoints?: number;
  velocity?:        number;
}
