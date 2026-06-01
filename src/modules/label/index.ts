export { LabelQuery }    from './label.query.js';
export { LabelMutation } from './label.mutation.js';
export { LabelAccess }   from './label.access.js';

export { default as labelRouter } from './label.routes.js';

export type {
  CreateLabelDto,
  UpdateLabelDto,
  LabelFilters,
  PopularLabelsFilters,
} from './label.types.js';