import { queryStats } from '../src/admin/admin.query';
const s = await queryStats();
console.log('growth:', JSON.stringify(s.growth));
console.log('growthByPlan:', JSON.stringify(s.growthByPlan));
console.log('taskActivity:', JSON.stringify(s.taskActivity));
