// feature.routes.ts
import { Router } from 'express';
import {
  createFeatureRequest,
  getFeatureRequests,
  getFeatureRequest,
  updateFeatureStatus,
  deleteFeatureRequest,
  castVote,
  getAdminContext,
  removeVote
} from './feature.controller.js';

export const featureRouter = Router();

featureRouter.get(   '/',               getFeatureRequests);
featureRouter.post(  '/',               createFeatureRequest);
featureRouter.get(   '/admin/me',       getAdminContext);        // is current user admin?
featureRouter.get(   '/:id',            getFeatureRequest);
featureRouter.patch( '/:id/status',     updateFeatureStatus);
featureRouter.delete('/:id',            deleteFeatureRequest);
featureRouter.post(  '/:id/vote',       castVote);
featureRouter.delete('/:id/vote',       removeVote)