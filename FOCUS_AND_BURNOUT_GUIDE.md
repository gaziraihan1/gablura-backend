# 🧠 Focura Focus & Burnout Detection System - Backend Guide

## Table of Contents
- [Overview](#overview)
- [How Focus Sessions Work](#how-focus-sessions-work)
- [Burnout Detection Algorithm](#burnout-detection-algorithm)
- [Calendar Intelligence System](#calendar-intelligence-system)
- [Wellness Recommendations Engine](#wellness-recommendations-engine)
- [Real-World Examples](#real-world-examples)
- [API Reference](#api-reference)
- [Architecture & Performance](#architecture--performance)

---

## Overview

Focura's focus and burnout system is a **scientifically-grounded, integrated solution** that combines:

1. **Focus Session Tracking** - Quantifies deep work with multiple session types
2. **Burnout Detection** - Predictive algorithm based on workload analysis
3. **Calendar Intelligence** - Daily aggregates of tasks, capacity, and wellness metrics
4. **Wellness Recommendations** - Personalized, actionable suggestions

**Key Principle**: _Unlike standalone tools (Toggl, RescueTime, Asana), Focura connects focus data with task management and capacity planning to prevent burnout before it happens._

---

## How Focus Sessions Work

### What is a Focus Session?

A focus session is a **time-boxed, task-linked productivity block** where the user commits to deep work without distractions.

**Key Fields**:
```typescript
{
  id: string;
  userId: string;
  taskId?: string;                    // Optional link to task
  type: 'POMODORO'                    // 25 min (classic Pomodoro)
       | 'SHORT_BREAK'                // 5 min recovery
       | 'LONG_BREAK'                 // 15 min recovery
       | 'DEEP_WORK'                  // 90 min (deep focus)
       | 'CUSTOM';                    // Custom duration (1-480 min)
  duration: number;                   // Minutes (1-480)
  completed: boolean;                 // Success indicator
  startedAt: Date;                    // Session start
  endedAt?: Date;                     // Session end (null if active)
}
```

### The Focus Session Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│ User starts focus session (API: POST /api/v1/focus-sessions/start)
│ ├─ Validates: no active session exists
│ ├─ Creates FocusSession record
│ └─ Returns session + task details
│
├─ User works for N minutes (client-side timer)
│
├─ User completes session (POST /:id/complete)
│ ├─ Marks completed = true, records endedAt
│ ├─ Triggers CalendarAggregation.recalculateDay()
│ ├─ Invalidates caches:
│ │  - Focus session caches (active, history, stats, streak)
│ │  - Calendar caches (aggregates, insights)
│ └─ Response: 201 (success)
│
└─ Stats auto-calculate
   ├─ totalSessions (count)
   ├─ totalMinutes (sum of duration)
   ├─ completedToday (count for today)
   ├─ averageSessionLength (totalMinutes / sessionCount)
   └─ focusStreak (consecutive days with ≥1 session)
```

### Focus Session States & Transitions

```
                    START SESSION
                          │
                          ▼
                    ┌──────────┐
                    │  ACTIVE  │
                    └──────────┘
                      │        │
                      │        │
         COMPLETE     │        │ CANCEL
         (auto or      │        │
          manual)      │        │
           │           │        │
           ▼           ▼        ▼
        ┌──────┐   ┌────────┐ ┌────────┐
        │DONE  │   │CANCELLED│ │EXPIRED │
        └──────┘   └────────┘ └────────┘
           │            │         │
           │            │         │
           └────────┬───┴─────────┘
                    │
                    ▼
           Removed from active
          (no longer fetchable)
```

### Benefits for Users

| User Need | How Focus Sessions Help |
|-----------|------------------------|
| **Accountability** | Visible timer + completion record prove focus time |
| **Streak Motivation** | Consecutive days builds commitment (gamification) |
| **Burnout Prevention** | Session data feeds into workload calculations |
| **Task Context** | Link sessions to tasks → understand effort per task |
| **Analytics** | See focus patterns over weeks/months |

**Real Benefit**: When a user completes a focus session, Focura **automatically adds it to that day's calendar aggregate**, improving the burnout risk calculation with real completion data (not just estimates).

---

## Burnout Detection Algorithm

### The Problem Burnout Detection Solves

**Without Focura:**
- Manager says "you look tired" (subjective)
- Team member burns out → leaves
- No warning signs captured

**With Focura:**
- System detects overload mathematically
- Alerts user 1 week before critical burnout
- Recommends specific actions (reduce load, take break, reschedule)

### How It Works: The 3-Step Algorithm

#### Step 1: Daily Workload Score

Every day, the system calculates a **workload multiplier (0.5 – 5.0+)**:

```
workloadScore = (plannedHours / dailyCapacity) 
              + (criticalTasks × 0.5) 
              + (focusRequiredTasks × 0.3)
```

**Components**:

1. **Task Load Component** (`plannedHours / dailyCapacity`)
   - Sum all task estimated hours
   - Divide by user's daily capacity (default: 8h)
   - Example: 10 hours planned / 8 capacity = **1.25×**

2. **Priority Weight** (`criticalTasks × 0.5`)
   - Count URGENT or HIGH priority tasks
   - Each adds 0.5 to score
   - Example: 2 critical tasks = **+1.0**

3. **Focus Demand** (`focusRequiredTasks × 0.3`)
   - Count tasks marked "focusRequired"
   - Each adds 0.3 (less impactful than priority)
   - Example: 3 focus-required tasks = **+0.9**

**Result**: 1.25 + 1.0 + 0.9 = **3.15 workload score** (highly overloaded)

#### Step 2: Weekly Burnout Risk Assessment

For each 7-day week, the system analyzes:

```
consecutiveHeavyDays = count of days where workloadScore > 1.2
avgDailyLoad = mean workloadScore for work days
```

**Risk Level Thresholds**:

| Condition | Risk Level | Meaning |
|-----------|-----------|----------|
| `consecutiveHeavyDays ≥ 5` OR `avgDailyLoad > 1.5` | 🔴 CRITICAL | User will burn out within days without intervention |
| `consecutiveHeavyDays ≥ 3` OR `avgDailyLoad > 1.2` | 🟠 HIGH | User showing burnout symptoms; needs relief soon |
| `heavyDays ≥ 2` OR `avgDailyLoad > 1.0` | 🟡 MODERATE | Workload above ideal; monitor closely |
| All else | 🟢 LOW | Healthy balance |

**Database Record** (`BurnoutSignal` table):
```sql
INSERT INTO BurnoutSignal (userId, weekStart, consecutiveHeavyDays, avgDailyLoad, riskLevel)
VALUES ('user-123', '2026-01-13', 4, 1.35, 'HIGH')
```

#### Step 3: Risk Progression Tracking

System tracks **changes week-over-week**:

```
Week 1: LOW → Week 2: MODERATE → Week 3: HIGH → Week 4: CRITICAL
```

**If risk increased**: Triggers urgent recommendation to prevent escalation.

### Real-World Example

**Monday (Day 1 of Week)**:
- Tasks: Design review (8h), Feature planning (4h), 1:1 meeting (1h) = 13h planned
- Critical: Design review = 1 task
- Focus-required: None
- **Workload Score** = (13/8) + (1 × 0.5) + (0 × 0.3) = **2.125**
- Status: ⚠️ Over capacity

**Tuesday-Thursday**: Similar overload (score 1.8-2.0 each)

**Friday**: Lighter day (score 0.8)

**Weekly Summary**:
- Consecutive heavy days: 4 (Mon-Thu)
- Average daily load: (2.125 + 1.9 + 1.95 + 2.0 + 0.8) / 5 = **1.755**
- **Risk Level**: 🔴 **CRITICAL** (4 consecutive heavy days)

**Outcome**: 
- BurnoutSignal created with CRITICAL risk
- Wellness recommendation generated: "Your burnout risk is critical. Consider taking a day off."
- User sees alert on dashboard

---

## Calendar Intelligence System

### What is Calendar Intelligence?

The **calendar intelligence system** precomputes and caches daily snapshots of your productivity landscape. It's the "brain" that powers burnout detection.

### CalendarDayAggregate: Daily Snapshot

Every day gets a persistent record:

```typescript
{
  id: string;
  userId: string;
  date: Date;                    // The day being aggregated
  
  // Task Metrics
  totalTasks: number;            // All open tasks
  dueTasks: number;              // Tasks with due date = this day
  criticalTasks: number;         // URGENT or HIGH priority
  milestoneCount: number;        // Project milestones due
  
  // Time Metrics
  plannedHours: float;           // Sum of estimated hours
  actualHours: float;            // Sum of time entry hours
  focusMinutes: number;          // Completed focus session minutes
  
  // Wellness Metrics
  workloadScore: float;          // The burnout multiplier
  overCapacity: boolean;         // plannedHours > dailyCapacity?
  hasPrimaryFocus: boolean;      // User set a primary task?
  isReviewDay: boolean;          // Friday (recurring reflection day)
  
  updatedAt: Date;               // Last recalculation timestamp
}
```

### How Aggregates Are Computed

**Trigger**: Task create/update/delete, focus session complete

**Optimization**: Batched computation (5 queries, not 7×N)

```typescript
// SINGLE ROUND-TRIP: Fetch all data for date range
const [capacity, tasks, timeEntries, focusSessions, dailyTasks, milestones] = 
  await Promise.all([
    prisma.userCapacity.findUnique(...),        // Query 1
    prisma.task.findMany(...),                  // Query 2
    prisma.timeEntry.findMany(...),             // Query 3
    prisma.focusSession.findMany(...),          // Query 4
    prisma.dailyTask.findMany(...),             // Query 5
    prisma.projectMilestone.findMany(...)       // Query 6
  ]);

// IN-MEMORY: Bucket data per day (O(N) operation)
const upserts = dates.map(date => {
  const dayTasks = tasks.filter(t => t.dueDate falls on date);
  const dayFocusSessions = focusSessions.filter(s => s.startedAt on date);
  // ... compute metrics
  return { userId, date, ...metrics };
});

// SINGLE TRANSACTION: Write all days atomically
await prisma.$transaction(
  upserts.map(data => 
    prisma.calendarDayAggregate.upsert({...})
  )
);
```

**Why This Matters**:
- ✅ **Fast**: 5 queries instead of 7 per day
- ✅ **Atomic**: All-or-nothing write (no partial data)
- ✅ **Scalable**: Works for users with 1k+ tasks

### Caching Strategy

**Cache Key**: `calendar:aggregates:{userId}:{workspaceId}:{startDate}:{endDate}`

**TTL**: 1 hour (expires when task/focus session changes)

**Invalidation Triggers**:
```typescript
// When task is created/updated/deleted:
await CalendarCache.invalidateAggregates(userId, workspaceId);

// When focus session completes:
await CalendarCache.invalidateAggregates(userId, session.task?.workspaceId);

// Automatic: After 1 hour, cache expires
```

### CalendarInsights: Weekly Analysis

**Synthesizes aggregates into actionable insights**:

```typescript
{
  totalPlannedHours: number;      // Sum across week
  totalCapacityHours: number;     // workDays × dailyCapacity
  commitmentGap: number;          // planned - capacity
  overloadedDays: number;         // Days where planned > capacity
  focusDays: number;              // Days with primary focus
  burnoutRisk: string;            // LOW/MODERATE/HIGH/CRITICAL
  timeAllocation: {               // If time entries tracked
    deepWork: percent,
    meetings: percent,
    admin: percent,
    learning: percent,
    other: percent
  }
}
```

**Example Response**:
```json
{
  "totalPlannedHours": 52,
  "totalCapacityHours": 40,
  "commitmentGap": 12,            // 30% over capacity
  "overloadedDays": 3,             // Mon, Tue, Wed
  "focusDays": 4,                  // Strong focus practice
  "burnoutRisk": "HIGH",           // 3 consecutive heavy days
  "timeAllocation": {
    "deepWork": 45,
    "meetings": 30,
    "admin": 15,
    "learning": 5,
    "other": 5
  }
}
```

---

## Wellness Recommendations Engine

### How Recommendations Are Generated

**Trigger**: Daily at **6:00 AM UTC** via cron job

**Deduplication**: Only generate if none created in last 24 hours

**Scope**: Analyzes past 7-30 days of data

### 6 Recommendation Types

#### 1. 🔴 BURNOUT_PREVENTION (Priority: 100)

**Trigger**: Latest burnout signal is HIGH or CRITICAL

**Messages**:
```
CRITICAL: "Your burnout risk is critical. Consider taking a day off or reducing your workload significantly."
HIGH:     "Your burnout risk is high. Try to lighten your schedule and prioritize rest."
```

**Expires**: 3 days

**Benefit**: Immediate alert + actionable next step

#### 2. 📈 WORKLOAD_ALERT (Priority: 90)

**Trigger**: Risk increased week-over-week (e.g., MODERATE → HIGH)

**Message**: 
```
"Your burnout risk has increased from MODERATE to HIGH over the past week. 
Review your task load and consider delegating or rescheduling."
```

**Also Triggered**: ≥3 overloaded days this week

**Message**:
```
"You've had 3+ overloaded days this week. Try to keep daily planned hours within your capacity."
```

**Expires**: 2-3 days

#### 3. ⚡ ENERGY_INSIGHT (Priority: 70)

**Trigger**: Low energy + high workload

```
if avgEnergy < 5 AND avgWorkload > 1.0:
  "Your energy levels have been low while workload remains high. 
   Consider breaking tasks into smaller chunks and taking more frequent breaks."
```

**Also Triggered**: High energy + manageable workload

```
if avgEnergy >= 7 AND avgWorkload <= 0.8:
  "Your energy levels are high and workload is manageable — 
   a great time to tackle those challenging tasks you've been postponing!"
```

**Expires**: 3 days

#### 4. 🎯 FOCUS_SUGGESTION (Priority: 50-60)

**Trigger**: No focus sessions this week OR < 3 sessions

```
if recentFocusSessions === 0:
  "You haven't logged any focus sessions this week. 
   Try a 25-minute Pomodoro session to boost productivity."
   
if recentFocusSessions < 3:
  "Only X focus session(s) this week. Aim for at least 3-5 sessions for consistent deep work."
```

**Expires**: 5-7 days

**Benefit**: Builds focus habit

#### 5. 📅 SCHEDULE_ADVICE (Priority: 75)

**Trigger**: Consistent over-planning

```
if avgPlanned > dailyCapacity × 1.2 for 3+ days:
  "You're consistently planning Xh/day but your capacity is Yh/day. 
   Consider adjusting your daily capacity or reducing task load."
```

**Expires**: 3 days

**Benefit**: Calibrates realistic planning

#### 6. 😴 BREAK_REMINDER (Priority: 55)

**Trigger**: 5+ consecutive work days without rest

```
"You've had tasks scheduled for 5+ consecutive days. 
 Remember to take at least one full rest day each week to prevent burnout."
```

**Expires**: 2 days

**Benefit**: Prevents cumulative fatigue

### Recommendation Lifecycle

```
┌────────────────────────────────────────────┐
│ 6:00 AM: Wellness cron job runs            │
├────────────────────────────────────────────┤
│ 1. Fetch past 4 burnout signals            │
│ 2. Fetch past 7 days of aggregates         │
│ 3. Fetch energy history                    │
│ 4. Analyze patterns                        │
│ 5. Generate new recommendations            │
│ 6. Check for duplicates (avoid spam)       │
│ 7. Save to DB (createMany)                 │
├────────────────────────────────────────────┤
│ User sees on dashboard:                    │
│ - Active (not dismissed)                   │
│ - Not expired (expiresAt > now)            │
│ - Ordered by priority (desc)               │
│ - Max 10 shown                             │
├────────────────────────────────────────────┤
│ User can:                                  │
│ ✓ Act on recommendation                    │
│ ✓ Dismiss (sets dismissed=true)            │
│ ✓ View again after expiry                  │
└────────────────────────────────────────────┘
```

### Example Timeline

```
Day 1 (Monday):
  - Burnout signal: MODERATE
  - Recommendations: None (risk is manageable)

Day 5 (Friday):
  - Burnout signal: HIGH (increased from MODERATE)
  - Workload alert generated: "Risk increased MODERATE → HIGH"
  - Focus suggestion: "Only 2 sessions this week, aim for 5"
  - Break reminder: "5 consecutive work days"
  - → Total: 3 active recommendations

Day 6 (Saturday):
  - User dismisses "Focus suggestion"
  - → 2 recommendations remain

Day 9 (Monday):
  - "Workload alert" expires (3 days old)
  - "Break reminder" expires (2 days old)
  - User still sees: Focus suggestion (dismissed but cached)
  - → Ready for fresh recommendations
```

---

## Real-World Examples

### Example 1: Startup PM Getting Burned Out

**User Profile**:
- Daily capacity: 8h
- Work schedule: Mon-Fri
- Weekly capacity: 40h

**Week 1 (Moderate Load)**:
```
Mon: 6h planned, 1 critical, 0 focus-required
     Score = (6/8) + (1×0.5) + 0 = 1.25

Tue: 7h, 1 critical, 1 focus → 1.85
Wed: 5h, 0 critical, 0 focus → 0.625
Thu: 8h, 2 critical, 2 focus → 2.3
Fri: 4h, 0 critical, 0 focus → 0.5

Weekly Summary:
- Avg load: 1.29
- Consecutive heavy: 3 (Mon-Wed)
- Risk: MODERATE
- Recommendation: "Consider reducing task load"
```

**Week 2 (Escalating)**:
```
Mon: 8h, 3 critical, 3 focus → 2.8
Tue: 9h, 2 critical, 2 focus → 2.4
Wed: 10h, 4 critical, 3 focus → 3.3
Thu: 8h, 1 critical, 1 focus → 1.8
Fri: 6h, 1 critical, 0 focus → 1.25

Weekly Summary:
- Avg load: 2.31 (📈 UP from 1.29)
- Consecutive heavy: 4 (Mon-Thu)
- Risk: CRITICAL
- Recommendations:
  ✓ Burnout prevention alert (priority 100)
  ✓ Risk increased alert (priority 90)
  ✓ Workload alert (priority 80)
  → User gets 3 alerts Friday morning
```

**Outcome**: PM reschedules 2 critical tasks → Week 3 load drops to 1.4 (MODERATE)

---

### Example 2: Engineer With Good Focus Habits

**User Profile**:
- Daily capacity: 8h
- Focus sessions: 4-5 per week (consistent)
- Energy logged: Yes (6-8 range)

**Week Analysis**:
```
Workload: 1.1 (healthy)
Energy: 7.2 (high)
Focus sessions: 5 (good)
Risk: LOW

Recommendations:
✓ "Your energy is high and workload is manageable — great time for challenging tasks!"
  (CAPACITY_TIP, priority 40)

No burnout alerts.
No break reminders.
```

**Outcome**: System reinforces good habits → User continues pattern

---

## API Reference

### Focus Session Endpoints

#### 1. Start Focus Session
```http
POST /api/v1/focus-sessions/start
Content-Type: application/json
Authorization: Bearer <accessToken>
X-CSRF-Token: <csrfToken>

{
  "taskId": "task-123",                    // Optional
  "type": "POMODORO",                      // POMODORO | SHORT_BREAK | LONG_BREAK | DEEP_WORK | CUSTOM
  "duration": 25                           // 1-480 minutes
}
```

**Response (201)**:
```json
{
  "success": true,
  "data": {
    "id": "session-456",
    "userId": "user-123",
    "taskId": "task-123",
    "type": "POMODORO",
    "duration": 25,
    "completed": false,
    "startedAt": "2026-01-15T10:00:00Z",
    "endedAt": null,
    "task": {
      "id": "task-123",
      "title": "Design Homepage"
    }
  },
  "message": "Focus session started"
}
```

**Errors**:
```json
{
  "success": false,
  "message": "You already have an active focus session",
  "code": "USER_HAS_ACTIVE_SESSION",
  "data": {
    "activeSession": {...}
  }
}
```

#### 2. Get Active Session
```http
GET /api/v1/focus-sessions/active
Authorization: Bearer <accessToken>
```

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "id": "session-456",
    "type": "POMODORO",
    "duration": 25,
    "startedAt": "2026-01-15T10:00:00Z",
    "task": {
      "id": "task-123",
      "title": "Design Homepage",
      "description": "..."
    }
  }
}
```

#### 3. Complete Focus Session
```http
POST /api/v1/focus-sessions/{sessionId}/complete
Authorization: Bearer <accessToken>
X-CSRF-Token: <csrfToken>
```

**Triggers**:
- Marks `completed = true`
- Records `endedAt = now()`
- Calls `CalendarAggregation.recalculateDay()` (if task has workspaceId)
- Invalidates: activeSession, history, stats, streak, aggregates, insights caches

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "id": "session-456",
    "completed": true,
    "endedAt": "2026-01-15T10:25:00Z",
    "duration": 25
  },
  "message": "Focus session completed"
}
```

#### 4. Get Session History
```http
GET /api/v1/focus-sessions/history?limit=30
Authorization: Bearer <accessToken>
```

**Response (200)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "session-456",
      "type": "POMODORO",
      "duration": 25,
      "completed": true,
      "startedAt": "2026-01-15T10:00:00Z",
      "endedAt": "2026-01-15T10:25:00Z",
      "task": {
        "id": "task-123",
        "title": "Design Homepage"
      }
    },
    ...
  ]
}
```

#### 5. Get Focus Stats
```http
GET /api/v1/focus-sessions/stats?startDate=2026-01-01&endDate=2026-01-31
Authorization: Bearer <accessToken>
```

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "totalSessions": 18,
    "totalMinutes": 450,              // 18 × 25min
    "completedToday": 2,
    "averageSessionLength": 25,
    "focusStreak": 7                  // 7 consecutive days with ≥1 session
  }
}
```

---

### Burnout & Wellness Endpoints

#### 1. Get Calendar Aggregates
```http
GET /api/v1/calendar/aggregates?startDate=2026-01-01&endDate=2026-01-31&workspaceId=ws-123
Authorization: Bearer <accessToken>
```

**Response (200)**:
```json
{
  "success": true,
  "data": [
    {
      "userId": "user-123",
      "date": "2026-01-15",
      "totalTasks": 8,
      "dueTasks": 5,
      "criticalTasks": 2,
      "milestoneCount": 1,
      "plannedHours": 10,
      "actualHours": 8.5,
      "focusMinutes": 75,
      "workloadScore": 1.85,
      "overCapacity": true,
      "hasPrimaryFocus": true,
      "isReviewDay": false
    },
    ...
  ]
}
```

#### 2. Get Calendar Insights
```http
GET /api/v1/calendar/insights?startDate=2026-01-13&endDate=2026-01-19&workspaceId=ws-123
Authorization: Bearer <accessToken>
```

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "totalPlannedHours": 52,
    "totalCapacityHours": 40,
    "commitmentGap": 12,
    "overloadedDays": 3,
    "focusDays": 4,
    "burnoutRisk": "HIGH",
    "timeAllocation": {
      "deepWork": 45,
      "meetings": 30,
      "admin": 15,
      "learning": 5,
      "other": 5
    }
  }
}
```

#### 3. Get Wellness Recommendations
```http
GET /api/v1/calendar/recommendations
Authorization: Bearer <accessToken>
```

**Response (200)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "rec-789",
      "type": "BURNOUT_PREVENTION",
      "message": "Your burnout risk is HIGH. Try to lighten your schedule and prioritize rest.",
      "priority": 100,
      "dismissed": false,
      "expiresAt": "2026-01-18",
      "createdAt": "2026-01-15"
    },
    {
      "id": "rec-790",
      "type": "FOCUS_SUGGESTION",
      "message": "Only 2 focus sessions this week. Aim for 3-5.",
      "priority": 50,
      "dismissed": false,
      "expiresAt": "2026-01-22",
      "createdAt": "2026-01-15"
    }
  ]
}
```

#### 4. Dismiss Recommendation
```http
PATCH /api/v1/calendar/recommendations/{recId}/dismiss
Authorization: Bearer <accessToken>
X-CSRF-Token: <csrfToken>
```

**Response (200)**:
```json
{
  "success": true,
  "message": "Recommendation dismissed"
}
```

#### 5. Log Energy Level
```http
POST /api/v1/calendar/energy
Content-Type: application/json
Authorization: Bearer <accessToken>
X-CSRF-Token: <csrfToken>

{
  "date": "2026-01-15",
  "energyLevel": 7,                  // 1-10 scale
  "note": "Good sleep, feeling productive"
}
```

**Response (201)**:
```json
{
  "success": true,
  "data": {
    "id": "energy-999",
    "userId": "user-123",
    "date": "2026-01-15",
    "energyLevel": 7,
    "note": "Good sleep, feeling productive",
    "createdAt": "2026-01-15T09:00:00Z"
  }
}
```

#### 6. Get Energy History
```http
GET /api/v1/calendar/energy/history?startDate=2026-01-01&endDate=2026-01-31&page=1&limit=31
Authorization: Bearer <accessToken>
```

**Response (200)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "energy-999",
      "date": "2026-01-15",
      "energyLevel": 7,
      "note": "Good sleep, feeling productive"
    },
    ...
  ],
  "pagination": {
    "page": 1,
    "limit": 31,
    "total": 25,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  }
}
```

---

## Architecture & Performance

### Performance Optimizations

#### 1. Batched Aggregation (vs Per-Day Queries)

**Without Optimization** (7×N queries):
```
For 30 days:
  Day 1: query tasks
  Day 1: query time entries
  Day 1: query focus sessions
  Day 1: query daily tasks
  Day 1: query milestones
  Day 1: query capacity
  Day 1: upsert aggregate
  ... repeat 30×
Total: 210 queries
```

**With Optimization** (5 queries):
```
Query 1: ALL tasks for date range
Query 2: ALL time entries for range
Query 3: ALL focus sessions for range
Query 4: ALL daily tasks for range
Query 5: ALL milestones for range
  + Upsert ALL in single transaction

Total: 6 queries (35× faster)
```

#### 2. Dual Prisma Clients (Read Replica)

**Write-Heavy Paths** (mutations): Use `prisma` (primary)
- Create/update/delete operations
- Consistency critical

**Read-Heavy Paths** (aggregates, analytics): Use `prismaRead` (replica)
- Notification list (30+ items)
- Calendar aggregates
- Analytics queries
- Storage stats

**Benefit**: Prevents write traffic from blocking reads

#### 3. Smart Caching

| Resource | TTL | Why |
|----------|-----|-----|
| Active session | 15s | User refreshes dashboard frequently |
| Aggregates | 1h | Relatively stable; mutations invalidate |
| Stats | 30min | Can batch updates |
| Insights | 1h | Same as aggregates |
| Recommendations | 24h | Generated once daily |

#### 4. Deduplication via Redis

**Problem**: Cron job runs 50 users, each with same rule → spam

**Solution**: Redis keys prevent duplicate recommendations
```
Key: `notification:sent:{taskId}:{userId}:{type}:{label}`
TTL: 25 hours
Check: If key exists, skip recommendation

Example:
  Key: `notification:sent:task-123:user-456:FOCUS_SUGGESTION:week`
  Prevents duplicate "focus sessions" alert for 25 hours
```

### Database Indexes

```sql
-- Burnout signal lookups
CREATE UNIQUE INDEX burnout_signal_user_week ON BurnoutSignal(userId, weekStart);

-- Calendar aggregate queries
CREATE UNIQUE INDEX calendar_day_agg_user_date ON CalendarDayAggregate(userId, date);

-- Energy tracking
CREATE UNIQUE INDEX energy_level_user_date ON EnergyLevel(userId, date);

-- Focus session queries
CREATE INDEX focus_session_user_completed ON FocusSession(userId, completed);
CREATE INDEX focus_session_user_date ON FocusSession(userId, startedAt);

-- Wellness recommendations
CREATE INDEX wellness_rec_user_dismissed ON WellnessRecommendation(userId, dismissed);
```

### Rate Limiting

All endpoints subject to per-user rate limiting:

| Plan | Limit | Window |
|------|-------|--------|
| Free | 60 | 1 minute |
| Pro | 300 | 1 minute |
| Enterprise | 1000 | 1 minute |

**Focus Session Endpoints**: Consume 1 credit each

---

## Key Takeaways

| Concept | What It Does | User Benefit |
|---------|-------------|---------------|
| **Focus Sessions** | Time-boxed, task-linked deep work blocks | Quantifiable focus + accountability |
| **Workload Score** | Daily multiplier (0.5–5.0+) based on tasks, priority, focus needs | Mathematical burnout prediction |
| **Calendar Aggregates** | Daily precomputed snapshots of capacity & wellness | Real-time health status |
| **Burnout Signals** | Weekly risk assessment (LOW/MODERATE/HIGH/CRITICAL) | Early warning system |
| **Wellness Recommendations** | Personalized, actionable suggestions (6 types) | Prevents burnout proactively |
| **Energy Tracking** | Daily 1–10 energy logging | Correlation with workload patterns |

---

## Next Steps for Developers

1. **Review** `src/modules/focusSession/` for session lifecycle
2. **Review** `src/modules/calendar/` for aggregation + burnout logic
3. **Check** `wellness.cron.ts` for recommendation generation
4. **Test** Start/complete session flow end-to-end
5. **Monitor** Cache invalidation on mutations
6. **Setup** Alerts on critical burnout signals (optional)

---

## Support & Questions

- **Focus sessions not updating?** → Check cache invalidation in mutations
- **Burnout detection seems wrong?** → Verify `userCapacity` settings and task estimated hours
- **Recommendations not showing?** → Check that cron job ran at 6 AM UTC
- **Performance issues?** → Review indexes, check N+1 queries, enable read replica

---

_Last Updated: January 2026_
_Focura Backend Team_