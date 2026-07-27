export type MilestoneStatus = 'ON_TRACK' | 'AT_RISK' | 'DELAYED' | 'COMPLETED';

export interface CreateMilestoneDto {
  title:        string;
  description?: string;
  dueDate?:     Date;
  color?:       string;
  icon?:        string;
  projectId:    string;
  dependsOnId?: string;
}

export interface UpdateMilestoneDto {
  title?:        string;
  description?:  string;
  status?:       MilestoneStatus;
  progress?:     number;
  color?:        string;
  icon?:         string;
  dueDate?:      Date;
  completed?:    boolean;
  dependsOnId?:  string | null;
}
