/**
 * modules/templates/templates.data.ts
 *
 * The official Focura template catalog — the single source of truth for the
 * seeded templates. Every template stores its full project snapshot in
 * `content` (sections with taskStatus, labels, tasks, milestones, views) so
 * the import endpoint can clone the whole structure in one transaction.
 *
 * Tier distribution (12 templates): 2 FREE · 9 PRO · 1 BUSINESS.
 *   FREE    → everyone, including the Free plan.
 *   PRO     → Pro, Business & Enterprise plans.
 *   BUSINESS → Business & Enterprise plans only.
 *
 * Section statuses are distinct per template on purpose: the project board is
 * status-driven and `ProjectSection` enforces `@@unique([projectId, taskStatus])`.
 */
import type { TemplateContent, TemplateTier } from './templates.types.js';

export interface OfficialTemplateSeed {
  slug: string;
  title: string;
  description: string;
  longDescription: string;
  category: string;
  complexity: string;
  tier: TemplateTier;
  icon: string;
  color: string;
  tags: string[];
  estimatedSetupMinutes: number;
  authorName: string;
  authorRole: string;
  content: TemplateContent;
}

const VIEWS = { kanban: 'KANBAN', list: 'LIST', calendar: 'CALENDAR', timeline: 'TIMELINE' } as const;

/** Templates curated into the featured strip on the templates page. */
export const FEATURED_TEMPLATE_SLUGS: string[] = [
  'engineering-sprint',
  'product-roadmap',
  'hiring-pipeline',
  'content-calendar',
  'product-launch',
];

/**
 * Baseline community ratings for the official catalog (average / count).
 * Seeded only on CREATE so re-running the seed never overwrites real ratings.
 */
export const TEMPLATE_BASELINE_RATINGS: Record<string, { average: number; count: number }> = {
  'quarterly-goals':       { average: 4.9, count: 210 },
  'content-calendar':      { average: 4.6, count: 130 },
  'engineering-sprint':    { average: 4.8, count: 160 },
  'bug-tracker':           { average: 4.7, count: 90 },
  'product-roadmap':       { average: 4.7, count: 110 },
  'hiring-pipeline':       { average: 4.6, count: 75 },
  'employee-onboarding':   { average: 4.8, count: 60 },
  'startup-launch':        { average: 4.7, count: 40 },
  'design-sprint':         { average: 4.5, count: 50 },
  'operations-runbook':    { average: 4.4, count: 35 },
  'social-media-campaign': { average: 4.6, count: 65 },
  'product-launch':        { average: 4.9, count: 70 },
};

export const OFFICIAL_TEMPLATES: OfficialTemplateSeed[] = [
  // ── FREE ────────────────────────────────────────────────────────────────────
  {
    slug: 'quarterly-goals',
    title: 'Quarterly Goals',
    description:
      'Set and track personal quarterly goals with weekly check-ins and habit streaks.',
    longDescription:
      'A personal OKR template for individuals. Define objectives with key results, review them weekly, and keep habit streaks alive. Links deep-focus sessions to specific goals so your effort lands where it matters.',
    category: 'personal',
    complexity: 'starter',
    tier: 'FREE',
    icon: '🎯',
    color: '#ec4899',
    tags: ['goals', 'okr', 'personal', 'habits', 'productivity'],
    estimatedSetupMinutes: 2,
    authorName: 'Focura Team',
    authorRole: 'Official',
    content: {
      sections: [
        { name: 'Objectives', color: '#ec4899', taskStatus: 'TODO' },
        { name: 'Key Results', color: '#a855f7', taskStatus: 'IN_PROGRESS' },
        { name: 'Weekly Review', color: '#3b82f6', taskStatus: 'IN_REVIEW' },
        { name: 'Completed', color: '#10b981', taskStatus: 'COMPLETED' },
      ],
      labels: [
        { name: 'Planning', color: '#8b5cf6' },
        { name: 'Review', color: '#3b82f6' },
        { name: 'Habit', color: '#10b981' },
        { name: 'Health', color: '#ec4899' },
        { name: 'Work', color: '#f59e0b' },
      ],
      tasks: [
        { title: 'Define 3 quarterly objectives', status: 'TODO', priority: 'HIGH', section: 'Objectives', label: 'Planning' },
        { title: 'Write 3 key results per objective', status: 'TODO', priority: 'HIGH', section: 'Objectives', label: 'Planning' },
        { title: 'Break objectives into weekly actions', status: 'TODO', priority: 'MEDIUM', section: 'Key Results', label: 'Planning' },
        { title: 'Weekly Sunday review', status: 'TODO', priority: 'MEDIUM', section: 'Weekly Review', label: 'Review' },
        { title: 'Daily reading habit (30 min)', status: 'TODO', priority: 'MEDIUM', section: 'Key Results', label: 'Habit' },
        { title: 'Exercise 4× per week', status: 'TODO', priority: 'MEDIUM', section: 'Key Results', label: 'Health' },
        { title: 'Mid-quarter check-in', status: 'TODO', priority: 'HIGH', section: 'Weekly Review', label: 'Review' },
      ],
      milestones: [
        { title: 'Goals set', dueWeek: 1 },
        { title: 'Mid-quarter check', dueWeek: 6 },
        { title: 'Quarter end review', dueWeek: 13 },
      ],
      views: [
        { name: 'Goal Board', type: VIEWS.kanban },
        { name: 'All Tasks', type: VIEWS.list },
        { name: 'Quarterly Calendar', type: VIEWS.calendar },
      ],
    },
  },
  {
    slug: 'content-calendar',
    title: 'Content Calendar',
    description:
      'Monthly editorial calendar with content types, channels, and publish scheduling.',
    longDescription:
      'Plan, assign, and track all content production in one project. Sections map to content status (Ideas → Writing → In Review → Scheduled → Published). Labels cover content type (Blog, LinkedIn, Twitter/X, Email, Video) and the Calendar view makes scheduling visual.',
    category: 'marketing',
    complexity: 'starter',
    tier: 'FREE',
    icon: '📅',
    color: '#f43f5e',
    tags: ['content', 'marketing', 'editorial', 'calendar', 'social'],
    estimatedSetupMinutes: 3,
    authorName: 'Focura Team',
    authorRole: 'Official',
    content: {
      sections: [
        { name: 'Ideas', color: '#f43f5e', taskStatus: 'TODO' },
        { name: 'Writing', color: '#3b82f6', taskStatus: 'IN_PROGRESS' },
        { name: 'In Review', color: '#a855f7', taskStatus: 'IN_REVIEW' },
        { name: 'Scheduled', color: '#f59e0b', taskStatus: 'BLOCKED' },
        { name: 'Published', color: '#10b981', taskStatus: 'COMPLETED' },
      ],
      labels: [
        { name: 'Blog', color: '#3b82f6' },
        { name: 'Email', color: '#f59e0b' },
        { name: 'LinkedIn', color: '#0077b5' },
        { name: 'Twitter/X', color: '#1da1f2' },
        { name: 'Video', color: '#ef4444' },
        { name: 'SEO', color: '#10b981' },
      ],
      tasks: [
        { title: 'Q3 content strategy doc', status: 'TODO', priority: 'HIGH', section: 'Ideas', label: 'Blog' },
        { title: 'Week 1: product update post', status: 'TODO', priority: 'HIGH', section: 'Writing', label: 'Blog' },
        { title: 'Customer spotlight video', status: 'TODO', priority: 'MEDIUM', section: 'Ideas', label: 'Video' },
        { title: 'Monthly email newsletter', status: 'TODO', priority: 'HIGH', section: 'Writing', label: 'Email' },
        { title: 'LinkedIn company update', status: 'TODO', priority: 'MEDIUM', section: 'Scheduled', label: 'LinkedIn' },
        { title: 'Republish top post for SEO', status: 'TODO', priority: 'LOW', section: 'Ideas', label: 'SEO' },
      ],
      milestones: [
        { title: 'Month 1 content locked', dueWeek: 0 },
        { title: 'Month 2 content locked', dueWeek: 4 },
      ],
      views: [
        { name: 'Content Board', type: VIEWS.kanban },
        { name: 'Publishing Calendar', type: VIEWS.calendar },
        { name: 'All Content', type: VIEWS.list },
      ],
    },
  },

  // ── PRO ────────────────────────────────────────────────────────────────────
  {
    slug: 'engineering-sprint',
    title: 'Agile Sprint Board',
    description:
      '2-week sprint with backlog, in-progress, review, and done columns. Includes story points via labels.',
    longDescription:
      'A battle-tested sprint board for software engineering teams. Pre-configured with backlog grooming, sprint planning, daily standups, and a retrospective. Kanban view with WIP limits, List view for backlog management. Labels cover story sizes (XS–XL) and types (Feature, Bug, Chore, Tech Debt).',
    category: 'engineering',
    complexity: 'starter',
    tier: 'PRO',
    icon: '⚙️',
    color: '#3b82f6',
    tags: ['agile', 'scrum', 'sprint', 'kanban', 'engineering'],
    estimatedSetupMinutes: 3,
    authorName: 'Focura Team',
    authorRole: 'Official',
    content: {
      sections: [
        { name: 'Backlog', color: '#94a3b8', taskStatus: 'TODO', wipLimit: 20 },
        { name: 'In Progress', color: '#3b82f6', taskStatus: 'IN_PROGRESS', wipLimit: 3 },
        { name: 'In Review', color: '#a855f7', taskStatus: 'IN_REVIEW', wipLimit: 5 },
        { name: 'Blocked', color: '#ef4444', taskStatus: 'BLOCKED', wipLimit: 999 },
        { name: 'Done', color: '#10b981', taskStatus: 'COMPLETED', wipLimit: 999 },
      ],
      labels: [
        { name: 'Feature', color: '#3b82f6' },
        { name: 'Bug', color: '#ef4444' },
        { name: 'Chore', color: '#8b5cf6' },
        { name: 'Tech Debt', color: '#f59e0b' },
        { name: 'XS', color: '#10b981' },
        { name: 'S', color: '#22c55e' },
        { name: 'M', color: '#f59e0b' },
        { name: 'L', color: '#f97316' },
        { name: 'XL', color: '#ef4444' },
      ],
      tasks: [
        { title: 'Sprint planning meeting', status: 'TODO', priority: 'HIGH', section: 'Backlog', label: 'Chore' },
        { title: 'Refine top 5 backlog items', status: 'TODO', priority: 'MEDIUM', section: 'Backlog', label: 'Chore' },
        { title: 'Set sprint goal', status: 'TODO', priority: 'HIGH', section: 'Backlog', label: 'Chore' },
        { title: 'User authentication flow', status: 'TODO', priority: 'URGENT', section: 'Backlog', label: 'Feature' },
        { title: 'Fix login redirect bug', status: 'TODO', priority: 'HIGH', section: 'In Progress', label: 'Bug' },
        { title: 'Write unit tests for auth', status: 'TODO', priority: 'MEDIUM', section: 'In Review', label: 'Chore' },
        { title: 'Sprint retrospective', status: 'TODO', priority: 'MEDIUM', section: 'Backlog', label: 'Chore' },
        { title: 'Update documentation', status: 'TODO', priority: 'LOW', section: 'Backlog', label: 'Chore' },
      ],
      milestones: [
        { title: 'Sprint Start', dueWeek: 0 },
        { title: 'Mid-Sprint Review', dueWeek: 1 },
        { title: 'Sprint End & Retro', dueWeek: 2 },
      ],
      views: [
        { name: 'Sprint Board', type: VIEWS.kanban },
        { name: 'Backlog (List)', type: VIEWS.list },
        { name: 'Sprint Timeline', type: VIEWS.timeline },
      ],
    },
  },
  {
    slug: 'bug-tracker',
    title: 'Bug Tracker',
    description:
      'Structured bug triage with severity levels, reproducibility notes, and a clear fix → verify workflow.',
    longDescription:
      'A dedicated bug tracking project. Bugs move from Reported → In Fix → Needs Verification → Closed, with Blocked and Won’t Fix lanes. Labels cover severity (Critical, High, Medium, Low), environment (Production, Staging, Dev), and browser/OS tags. Includes a recurring weekly triage task.',
    category: 'engineering',
    complexity: 'intermediate',
    tier: 'PRO',
    icon: '🐛',
    color: '#ef4444',
    tags: ['bugs', 'qa', 'triage', 'engineering'],
    estimatedSetupMinutes: 2,
    authorName: 'Focura Team',
    authorRole: 'Official',
    content: {
      sections: [
        { name: 'Reported', color: '#ef4444', taskStatus: 'TODO' },
        { name: 'In Fix', color: '#f97316', taskStatus: 'IN_PROGRESS' },
        { name: 'Needs Verification', color: '#a855f7', taskStatus: 'IN_REVIEW' },
        { name: 'Blocked', color: '#6b7280', taskStatus: 'BLOCKED' },
        { name: 'Closed', color: '#10b981', taskStatus: 'COMPLETED' },
        { name: "Won't Fix", color: '#64748b', taskStatus: 'CANCELLED' },
      ],
      labels: [
        { name: 'Critical', color: '#dc2626' },
        { name: 'High', color: '#f97316' },
        { name: 'Medium', color: '#f59e0b' },
        { name: 'Low', color: '#6b7280' },
        { name: 'Production', color: '#7c3aed' },
        { name: 'Staging', color: '#0ea5e9' },
        { name: 'Regression', color: '#ec4899' },
        { name: 'Process', color: '#8b5cf6' },
      ],
      tasks: [
        { title: 'Weekly bug triage', status: 'TODO', priority: 'HIGH', section: 'Reported', label: 'Process' },
        { title: 'Crash on mobile Safari', status: 'TODO', priority: 'URGENT', section: 'Reported', label: 'Critical' },
        { title: 'Checkout fails on production', status: 'TODO', priority: 'URGENT', section: 'In Fix', label: 'Production' },
        { title: 'Button misaligned on IE', status: 'TODO', priority: 'LOW', section: 'Reported', label: 'Low' },
        { title: 'Race condition in websockets', status: 'TODO', priority: 'HIGH', section: 'Needs Verification', label: 'High' },
        { title: 'Avatar does not refresh', status: 'TODO', priority: 'MEDIUM', section: 'Blocked', label: 'Regression' },
      ],
      milestones: [],
      views: [
        { name: 'Triage Board', type: VIEWS.kanban },
        { name: 'All Bugs', type: VIEWS.list },
      ],
    },
  },
  {
    slug: 'product-roadmap',
    title: 'Product Roadmap',
    description:
      'Quarterly roadmap with Now / Next / Later columns, OKR alignment labels, and milestone checkpoints.',
    longDescription:
      'A high-level product roadmap for software teams. Now (this quarter), In Progress, In Review, Later (future), and Shipped columns. Labels align features to OKR pillars (Growth, Retention, Revenue, Reliability). Includes quarterly planning milestones and a monthly leadership review.',
    category: 'product',
    complexity: 'intermediate',
    tier: 'PRO',
    icon: '🗺️',
    color: '#8b5cf6',
    tags: ['product', 'roadmap', 'okr', 'strategy', 'planning'],
    estimatedSetupMinutes: 5,
    authorName: 'Focura Team',
    authorRole: 'Official',
    content: {
      sections: [
        { name: 'Now (This Quarter)', color: '#8b5cf6', taskStatus: 'TODO' },
        { name: 'In Progress', color: '#3b82f6', taskStatus: 'IN_PROGRESS' },
        { name: 'In Review', color: '#a855f7', taskStatus: 'IN_REVIEW' },
        { name: 'Later (Future)', color: '#94a3b8', taskStatus: 'BLOCKED' },
        { name: 'Shipped', color: '#10b981', taskStatus: 'COMPLETED' },
      ],
      labels: [
        { name: 'Growth', color: '#10b981' },
        { name: 'Retention', color: '#3b82f6' },
        { name: 'Revenue', color: '#f59e0b' },
        { name: 'Reliability', color: '#8b5cf6' },
        { name: 'Strategic', color: '#ec4899' },
      ],
      tasks: [
        { title: 'Q3 OKR alignment session', status: 'TODO', priority: 'HIGH', section: 'Now (This Quarter)', label: 'Strategic' },
        { title: 'Dark mode support', status: 'TODO', priority: 'HIGH', section: 'Now (This Quarter)', label: 'Retention' },
        { title: 'API v2 public release', status: 'TODO', priority: 'MEDIUM', section: 'In Progress', label: 'Revenue' },
        { title: 'Mobile app (iOS)', status: 'TODO', priority: 'MEDIUM', section: 'Later (Future)', label: 'Growth' },
        { title: 'Enterprise SSO', status: 'TODO', priority: 'HIGH', section: 'Later (Future)', label: 'Reliability' },
        { title: 'Quarterly leadership review', status: 'TODO', priority: 'HIGH', section: 'Now (This Quarter)', label: 'Strategic' },
      ],
      milestones: [
        { title: 'Q3 Planning Complete', dueWeek: 1 },
        { title: 'Mid-Quarter Review', dueWeek: 6 },
        { title: 'Q3 Wrap-up', dueWeek: 13 },
      ],
      views: [
        { name: 'Roadmap Board', type: VIEWS.kanban },
        { name: 'Roadmap Calendar', type: VIEWS.calendar },
        { name: 'All Items', type: VIEWS.list },
      ],
    },
  },
  {
    slug: 'hiring-pipeline',
    title: 'Hiring Pipeline',
    description:
      'Track candidates from application to offer with structured interview stages and feedback tasks.',
    longDescription:
      'A structured recruiting pipeline for growing teams. Candidates move from Applied → Screening → Interviewing → Decision → Hired, with a Rejected lane. Labels track role, department, and interview feedback (Strong Yes / Maybe / No). Includes recurring weekly recruiter sync tasks.',
    category: 'hr',
    complexity: 'intermediate',
    tier: 'PRO',
    icon: '🧑‍💼',
    color: '#10b981',
    tags: ['hiring', 'recruiting', 'hr', 'people', 'interviews'],
    estimatedSetupMinutes: 4,
    authorName: 'Focura Team',
    authorRole: 'Official',
    content: {
      sections: [
        { name: 'Applied', color: '#10b981', taskStatus: 'TODO' },
        { name: 'Screening', color: '#0ea5e9', taskStatus: 'IN_PROGRESS' },
        { name: 'Interviewing', color: '#8b5cf6', taskStatus: 'IN_REVIEW' },
        { name: 'Decision', color: '#f59e0b', taskStatus: 'BLOCKED' },
        { name: 'Hired', color: '#22c55e', taskStatus: 'COMPLETED' },
        { name: 'Rejected', color: '#6b7280', taskStatus: 'CANCELLED' },
      ],
      labels: [
        { name: 'Engineering', color: '#3b82f6' },
        { name: 'Design', color: '#f59e0b' },
        { name: 'Marketing', color: '#ec4899' },
        { name: 'Process', color: '#8b5cf6' },
        { name: 'Strong Yes', color: '#10b981' },
        { name: 'Maybe', color: '#f59e0b' },
        { name: 'No', color: '#ef4444' },
      ],
      tasks: [
        { title: 'Weekly recruiter sync', status: 'TODO', priority: 'HIGH', section: 'Applied', label: 'Process' },
        { title: 'Write JD for Senior FE', status: 'TODO', priority: 'HIGH', section: 'Applied', label: 'Engineering' },
        { title: 'Candidate: Jane Doe', status: 'TODO', priority: 'MEDIUM', section: 'Interviewing', label: 'Engineering' },
        { title: 'Send offer letter template', status: 'TODO', priority: 'HIGH', section: 'Decision', label: 'Process' },
        { title: 'Reference checks: John', status: 'TODO', priority: 'HIGH', section: 'Decision', label: 'Engineering' },
        { title: 'Greenhouse sync automation', status: 'TODO', priority: 'LOW', section: 'Applied', label: 'Process' },
      ],
      milestones: [],
      views: [
        { name: 'Pipeline Board', type: VIEWS.kanban },
        { name: 'All Candidates', type: VIEWS.list },
      ],
    },
  },
  {
    slug: 'employee-onboarding',
    title: 'Employee Onboarding',
    description:
      '30-day onboarding plan covering tools setup, team introductions, first project, and 30-day check-in.',
    longDescription:
      'A structured first-30-days plan for new team members. Day 1 covers tools and accounts, Week 1 is setup and introductions, Week 2 is shadowing and learning, and Weeks 3–4 are the first real contributions. Includes a buddy assignment and a 30-day review milestone.',
    category: 'hr',
    complexity: 'starter',
    tier: 'PRO',
    icon: '🎉',
    color: '#06b6d4',
    tags: ['onboarding', 'hr', 'new-hire', 'people'],
    estimatedSetupMinutes: 3,
    authorName: 'Focura Team',
    authorRole: 'Official',
    content: {
      sections: [
        { name: 'Day 1', color: '#06b6d4', taskStatus: 'TODO' },
        { name: 'Week 1', color: '#3b82f6', taskStatus: 'IN_PROGRESS' },
        { name: 'Week 2', color: '#a855f7', taskStatus: 'IN_REVIEW' },
        { name: 'Weeks 3–4', color: '#f59e0b', taskStatus: 'BLOCKED' },
        { name: 'Completed', color: '#10b981', taskStatus: 'COMPLETED' },
      ],
      labels: [
        { name: 'IT Setup', color: '#6b7280' },
        { name: 'People', color: '#10b981' },
        { name: 'Learning', color: '#3b82f6' },
        { name: 'Work', color: '#8b5cf6' },
        { name: 'Admin', color: '#f59e0b' },
      ],
      tasks: [
        { title: 'Set up laptop and accounts', status: 'TODO', priority: 'URGENT', section: 'Day 1', label: 'IT Setup' },
        { title: 'Meet the team (intro call)', status: 'TODO', priority: 'HIGH', section: 'Day 1', label: 'People' },
        { title: 'Read company handbook', status: 'TODO', priority: 'MEDIUM', section: 'Week 1', label: 'Learning' },
        { title: 'Shadow a product demo', status: 'TODO', priority: 'MEDIUM', section: 'Week 2', label: 'Learning' },
        { title: 'First PR / first deliverable', status: 'TODO', priority: 'HIGH', section: 'Weeks 3–4', label: 'Work' },
        { title: '30-day check-in with manager', status: 'TODO', priority: 'HIGH', section: 'Weeks 3–4', label: 'People' },
        { title: 'Order hardware accessories', status: 'TODO', priority: 'LOW', section: 'Day 1', label: 'Admin' },
      ],
      milestones: [
        { title: 'End of Week 1', dueWeek: 1 },
        { title: '30-day Review', dueWeek: 4 },
      ],
      views: [
        { name: 'Onboarding Board', type: VIEWS.kanban },
        { name: '30-Day Calendar', type: VIEWS.calendar },
      ],
    },
  },
  {
    slug: 'startup-launch',
    title: 'Startup Launch Plan',
    description:
      'Zero to launch in 90 days — product, legal, marketing, and fundraising in one master project.',
    longDescription:
      'An opinionated 90-day plan for early-stage startups getting to their first public launch. Covers company formation (legal, banking), product MVP scoping, investor deck prep, early user acquisition, and launch week execution. Labels carry the department (Legal, Product, Growth, Fundraising).',
    category: 'startup',
    complexity: 'advanced',
    tier: 'PRO',
    icon: '⚡',
    color: '#f97316',
    tags: ['startup', 'launch', 'mvp', 'fundraising', 'product'],
    estimatedSetupMinutes: 10,
    authorName: 'Focura Team',
    authorRole: 'Official',
    content: {
      sections: [
        { name: 'To Do', color: '#f97316', taskStatus: 'TODO' },
        { name: 'In Progress', color: '#3b82f6', taskStatus: 'IN_PROGRESS' },
        { name: 'In Review', color: '#a855f7', taskStatus: 'IN_REVIEW' },
        { name: 'Blocked', color: '#ef4444', taskStatus: 'BLOCKED' },
        { name: 'Done', color: '#10b981', taskStatus: 'COMPLETED' },
      ],
      labels: [
        { name: 'Legal', color: '#f59e0b' },
        { name: 'Product', color: '#8b5cf6' },
        { name: 'Fundraising', color: '#10b981' },
        { name: 'Growth', color: '#3b82f6' },
        { name: 'Marketing', color: '#ec4899' },
        { name: 'Blocker', color: '#dc2626' },
      ],
      tasks: [
        { title: 'Incorporate the company', status: 'TODO', priority: 'URGENT', section: 'To Do', label: 'Legal' },
        { title: 'Open business bank account', status: 'TODO', priority: 'HIGH', section: 'To Do', label: 'Legal' },
        { title: 'Define MVP scope (10 features max)', status: 'TODO', priority: 'URGENT', section: 'In Progress', label: 'Product' },
        { title: 'Build investor pitch deck', status: 'TODO', priority: 'HIGH', section: 'In Review', label: 'Fundraising' },
        { title: 'Identify 100 launch users', status: 'TODO', priority: 'HIGH', section: 'In Progress', label: 'Growth' },
        { title: 'Submit to Product Hunt', status: 'TODO', priority: 'HIGH', section: 'To Do', label: 'Marketing' },
        { title: 'Customer interviews (×10)', status: 'TODO', priority: 'HIGH', section: 'In Review', label: 'Growth' },
      ],
      milestones: [
        { title: 'Company formed', dueWeek: 2 },
        { title: 'MVP scoped', dueWeek: 4 },
        { title: 'Beta users onboard', dueWeek: 8 },
        { title: 'Public launch 🚀', dueWeek: 12 },
      ],
      views: [
        { name: 'Launch Board', type: VIEWS.kanban },
        { name: 'Launch Calendar', type: VIEWS.calendar },
        { name: 'Launch Timeline', type: VIEWS.timeline },
      ],
    },
  },
  {
    slug: 'design-sprint',
    title: 'Design Sprint',
    description:
      'Run a 5-day design sprint — understand, ideate, decide, prototype, and test — with phase labels.',
    longDescription:
      'The Google Ventures 5-day design sprint, adapted for Focura. The board uses the standard workflow columns while phase labels (Day 1 Understand → Day 5 Test) keep every task anchored to its sprint day. Includes facilitation tasks and a test-session milestone.',
    category: 'design',
    complexity: 'intermediate',
    tier: 'PRO',
    icon: '🎨',
    color: '#f59e0b',
    tags: ['design', 'sprint', 'ux', 'workshop', 'prototype'],
    estimatedSetupMinutes: 5,
    authorName: 'Focura Team',
    authorRole: 'Official',
    content: {
      sections: [
        { name: 'To Do', color: '#f59e0b', taskStatus: 'TODO' },
        { name: 'In Progress', color: '#3b82f6', taskStatus: 'IN_PROGRESS' },
        { name: 'In Review', color: '#a855f7', taskStatus: 'IN_REVIEW' },
        { name: 'Blocked', color: '#ef4444', taskStatus: 'BLOCKED' },
        { name: 'Done', color: '#10b981', taskStatus: 'COMPLETED' },
      ],
      labels: [
        { name: 'Day 1 Understand', color: '#3b82f6' },
        { name: 'Day 2 Diverge', color: '#8b5cf6' },
        { name: 'Day 3 Decide', color: '#f59e0b' },
        { name: 'Day 4 Prototype', color: '#f97316' },
        { name: 'Day 5 Test', color: '#10b981' },
      ],
      tasks: [
        { title: 'Expert interviews & mapping', status: 'TODO', priority: 'HIGH', section: 'To Do', label: 'Day 1 Understand' },
        { title: 'How-might-we statements', status: 'TODO', priority: 'HIGH', section: 'To Do', label: 'Day 2 Diverge' },
        { title: 'Crazy-8s ideation', status: 'TODO', priority: 'HIGH', section: 'In Progress', label: 'Day 2 Diverge' },
        { title: 'Vote & storyboard the winner', status: 'TODO', priority: 'HIGH', section: 'In Progress', label: 'Day 3 Decide' },
        { title: 'Build clickable prototype', status: 'TODO', priority: 'URGENT', section: 'In Progress', label: 'Day 4 Prototype' },
        { title: 'Run 5 user tests', status: 'TODO', priority: 'HIGH', section: 'In Review', label: 'Day 5 Test' },
      ],
      milestones: [
        { title: 'Prototype ready', dueWeek: 1 },
        { title: 'Test session complete', dueWeek: 1 },
      ],
      views: [
        { name: 'Sprint Board', type: VIEWS.kanban },
        { name: 'All Tasks', type: VIEWS.list },
      ],
    },
  },
  {
    slug: 'operations-runbook',
    title: 'Operations Runbook',
    description:
      'Incident management and SOP tracking with severity labels and a clear investigate → mitigate → resolve flow.',
    longDescription:
      'Keep operations under control with a shared runbook. Incidents move from Open → Investigating → Mitigation → Resolved, with a Blocked lane for waiting on third parties. Labels carry severity (SEV1–SEV3) and system area. Includes recurring on-call handover tasks.',
    category: 'operations',
    complexity: 'intermediate',
    tier: 'PRO',
    icon: '🧰',
    color: '#0891b2',
    tags: ['operations', 'incident', 'sop', 'oncall', 'reliability'],
    estimatedSetupMinutes: 4,
    authorName: 'Focura Team',
    authorRole: 'Official',
    content: {
      sections: [
        { name: 'Open', color: '#ef4444', taskStatus: 'TODO' },
        { name: 'Investigating', color: '#f97316', taskStatus: 'IN_PROGRESS' },
        { name: 'Mitigation', color: '#a855f7', taskStatus: 'IN_REVIEW' },
        { name: 'Blocked', color: '#6b7280', taskStatus: 'BLOCKED' },
        { name: 'Resolved', color: '#10b981', taskStatus: 'COMPLETED' },
      ],
      labels: [
        { name: 'SEV1', color: '#dc2626' },
        { name: 'SEV2', color: '#f97316' },
        { name: 'SEV3', color: '#f59e0b' },
        { name: 'API', color: '#3b82f6' },
        { name: 'Database', color: '#8b5cf6' },
      ],
      tasks: [
        { title: 'Write on-call handover checklist', status: 'TODO', priority: 'HIGH', section: 'Open', label: 'SEV2' },
        { title: 'API latency spike investigation', status: 'TODO', priority: 'URGENT', section: 'Investigating', label: 'API' },
        { title: 'DB connection pool exhaustion', status: 'TODO', priority: 'URGENT', section: 'Mitigation', label: 'Database' },
        { title: 'Update status page template', status: 'TODO', priority: 'MEDIUM', section: 'Open', label: 'SEV3' },
        { title: 'Postmortem: last week outage', status: 'TODO', priority: 'HIGH', section: 'Open', label: 'SEV1' },
        { title: 'Rotate prod credentials', status: 'TODO', priority: 'HIGH', section: 'Blocked', label: 'SEV2' },
      ],
      milestones: [],
      views: [
        { name: 'Incident Board', type: VIEWS.kanban },
        { name: 'All Incidents', type: VIEWS.list },
      ],
    },
  },
  {
    slug: 'social-media-campaign',
    title: 'Social Media Campaign',
    description:
      'Plan, create, and publish a multi-channel social campaign with approval and scheduling stages.',
    longDescription:
      'Coordinate a full social campaign from strategy to publishing. Ideas move through Planning → Creating → In Review → Scheduled → Published, with approval labels and platform labels (LinkedIn, Instagram, TikTok, X). Calendar view shows the publishing cadence at a glance.',
    category: 'marketing',
    complexity: 'starter',
    tier: 'PRO',
    icon: '📣',
    color: '#ea580c',
    tags: ['social', 'marketing', 'campaign', 'content', 'brand'],
    estimatedSetupMinutes: 3,
    authorName: 'Focura Team',
    authorRole: 'Official',
    content: {
      sections: [
        { name: 'Planning', color: '#ea580c', taskStatus: 'TODO' },
        { name: 'Creating', color: '#3b82f6', taskStatus: 'IN_PROGRESS' },
        { name: 'In Review', color: '#a855f7', taskStatus: 'IN_REVIEW' },
        { name: 'Scheduled', color: '#f59e0b', taskStatus: 'BLOCKED' },
        { name: 'Published', color: '#10b981', taskStatus: 'COMPLETED' },
      ],
      labels: [
        { name: 'LinkedIn', color: '#0077b5' },
        { name: 'Instagram', color: '#e1306c' },
        { name: 'TikTok', color: '#111827' },
        { name: 'X', color: '#1da1f2' },
        { name: 'Needs Approval', color: '#ef4444' },
      ],
      tasks: [
        { title: 'Campaign brief & target audience', status: 'TODO', priority: 'HIGH', section: 'Planning', label: 'Needs Approval' },
        { title: 'Write 5 post variants', status: 'TODO', priority: 'HIGH', section: 'Creating', label: 'LinkedIn' },
        { title: 'Design visuals (Figma)', status: 'TODO', priority: 'HIGH', section: 'Creating', label: 'Instagram' },
        { title: 'Legal review of claims', status: 'TODO', priority: 'URGENT', section: 'In Review', label: 'Needs Approval' },
        { title: 'Schedule launch week posts', status: 'TODO', priority: 'MEDIUM', section: 'Scheduled', label: 'TikTok' },
        { title: 'Community replies (launch day)', status: 'TODO', priority: 'MEDIUM', section: 'Planning', label: 'X' },
      ],
      milestones: [
        { title: 'Creative locked', dueWeek: 1 },
        { title: 'Launch week', dueWeek: 2 },
      ],
      views: [
        { name: 'Campaign Board', type: VIEWS.kanban },
        { name: 'Publishing Calendar', type: VIEWS.calendar },
      ],
    },
  },

  // ── BUSINESS ────────────────────────────────────────────────────────────────
  {
    slug: 'product-launch',
    title: 'Product Launch Checklist',
    description:
      'End-to-end launch preparation across engineering, marketing, support, and legal with countdown milestones.',
    longDescription:
      'Everything needed to ship a product from internal beta to public launch. Covers engineering (feature freeze, load testing, monitoring), marketing (launch post, social, email), legal (T&Cs, privacy), and customer success (support docs, FAQ). Milestones mark T-30, T-14, T-7, and launch day. The flagship Business-tier template.',
    category: 'product',
    complexity: 'advanced',
    tier: 'BUSINESS',
    icon: '🚀',
    color: '#7c3aed',
    tags: ['launch', 'product', 'checklist', 'marketing', 'engineering', 'go-to-market'],
    estimatedSetupMinutes: 8,
    authorName: 'Focura Team',
    authorRole: 'Official',
    content: {
      sections: [
        { name: 'Planning', color: '#7c3aed', taskStatus: 'TODO' },
        { name: 'In Progress', color: '#3b82f6', taskStatus: 'IN_PROGRESS' },
        { name: 'In Review', color: '#a855f7', taskStatus: 'IN_REVIEW' },
        { name: 'Blocked', color: '#ef4444', taskStatus: 'BLOCKED' },
        { name: 'Launched', color: '#10b981', taskStatus: 'COMPLETED' },
      ],
      labels: [
        { name: 'Engineering', color: '#3b82f6' },
        { name: 'Marketing', color: '#ec4899' },
        { name: 'Legal', color: '#f59e0b' },
        { name: 'Support', color: '#10b981' },
        { name: 'Blocker', color: '#dc2626' },
      ],
      tasks: [
        { title: 'Feature freeze', status: 'TODO', priority: 'URGENT', section: 'Planning', label: 'Engineering' },
        { title: 'Load testing (10k users)', status: 'TODO', priority: 'URGENT', section: 'In Progress', label: 'Engineering' },
        { title: 'Write launch blog post', status: 'TODO', priority: 'HIGH', section: 'In Progress', label: 'Marketing' },
        { title: 'Schedule social media', status: 'TODO', priority: 'MEDIUM', section: 'In Progress', label: 'Marketing' },
        { title: 'Review Terms & Conditions', status: 'TODO', priority: 'HIGH', section: 'In Review', label: 'Legal' },
        { title: 'Write support FAQ', status: 'TODO', priority: 'HIGH', section: 'In Progress', label: 'Support' },
        { title: 'Enable monitoring dashboards', status: 'TODO', priority: 'HIGH', section: 'In Progress', label: 'Engineering' },
        { title: 'Press embargo lifted', status: 'TODO', priority: 'URGENT', section: 'Planning', label: 'Marketing' },
      ],
      milestones: [
        { title: 'T-30: Kickoff', dueWeek: -4 },
        { title: 'T-14: Content Ready', dueWeek: -2 },
        { title: 'T-7: Final QA', dueWeek: -1 },
        { title: 'Launch Day 🚀', dueWeek: 0 },
        { title: 'T+7: Post-Launch Review', dueWeek: 1 },
      ],
      views: [
        { name: 'Launch Board', type: VIEWS.kanban },
        { name: 'Launch Calendar', type: VIEWS.calendar },
        { name: 'Countdown Timeline', type: VIEWS.timeline },
      ],
    },
  },
];
