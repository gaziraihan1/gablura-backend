
import { Router } from 'express';
import {
  getCalendarAggregates,
  getCalendarInsights,
  getSystemEvents,
  getGoalCheckpoints,
  createGoalCheckpoint,
  recalculateAggregate,
  initializeUserSettings,
  getCapacity,
  updateCapacity,
  getSchedule,
  updateSchedule,
  logEnergy,
  getEnergyLevel,
  getEnergyHistory,
  exportEnergyHistory,
  getBurnoutTrends,
  getRecommendations,
  dismissRecommendation,
  dismissAllRecommendations,
} from './calendar.controller.js';

const router = Router();

router.get('/aggregates',    getCalendarAggregates);
router.get('/insights',      getCalendarInsights);
router.get('/system-events', getSystemEvents);
router.get('/goals',         getGoalCheckpoints);
router.get('/capacity',      getCapacity);
router.get('/schedule',      getSchedule);
router.get('/energy',        getEnergyLevel);
router.get('/energy/history', getEnergyHistory);
router.get('/energy/export', exportEnergyHistory);
router.get('/burnout-trends', getBurnoutTrends);
router.get('/recommendations', getRecommendations);

router.post('/goals',        createGoalCheckpoint);
router.post('/recalculate',  recalculateAggregate);
router.post('/initialize',   initializeUserSettings);
router.post('/energy',       logEnergy);

router.put('/capacity',      updateCapacity);
router.put('/schedule',      updateSchedule);

router.patch('/recommendations/:id/dismiss', dismissRecommendation);
router.post('/recommendations/dismiss-all', dismissAllRecommendations);

export default router;