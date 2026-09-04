import { FeatureRepository }  from './feature.repository.js';
import { isGabluraAdminUser }  from '../../config/admin.config.js';
import { NotFoundError, ForbiddenError } from '../../errors/index.js';
import type {
  CreateFeatureRequestInput,
  UpdateFeatureStatusInput,
  FeatureFilterParams,
  VoteType,
} from './feature.types.js';

export const FeatureService = {
  async create(input: CreateFeatureRequestInput) {
    return FeatureRepository.create(input);
  },

  async getMany(params: FeatureFilterParams, userId: string) {
    return FeatureRepository.findMany(params, userId);
  },

  async getOne(id: string, userId: string) {
    const feature = await FeatureRepository.findById(id, userId);
    if (!feature) throw new NotFoundError('Feature request');
    return feature;
  },

  async updateStatus(id: string, userId: string, role: string, input: UpdateFeatureStatusInput) {
    if (!isGabluraAdminUser(role, userId))
      throw new ForbiddenError('Only Gablura admins can update feature status');

    const feature = await FeatureRepository.findById(id, null);
    if (!feature) throw new NotFoundError('Feature request');

    return FeatureRepository.updateStatus(id, input);
  },

  async delete(id: string, userId: string, role: string) {
    if (!isGabluraAdminUser(role, userId))
      throw new ForbiddenError('Only Gablura admins can delete feature requests');

    const feature = await FeatureRepository.findById(id, null);
    if (!feature) throw new NotFoundError('Feature request');

    await FeatureRepository.delete(id);
  },

  async vote(id: string, userId: string, type: VoteType) {
    const feature = await FeatureRepository.findById(id, null);
    if (!feature) throw new NotFoundError('Feature request');

    const action  = await FeatureRepository.vote(id, userId, type);
    // Bypass cache to get fresh data after vote change
    const updated = await FeatureRepository.findByIdUncached(id, userId);
    return { action, feature: updated };
  },

  async removeVote(id: string, userId: string) {
    const feature = await FeatureRepository.findById(id, null);
    if (!feature) throw new NotFoundError('Feature request');

    await FeatureRepository.removeVote(id, userId);
  },
};