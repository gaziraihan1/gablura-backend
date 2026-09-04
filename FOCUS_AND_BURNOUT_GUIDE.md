# 🧠 Gablura Focus & Burnout Detection System - Backend Guide

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

Gablura's focus and burnout system is a **scientifically-grounded, integrated solution** that combines:

1. **Focus Session Tracking** - Quantifies deep work with multiple session types
2. **Burnout Detection** - Predictive algorithm based on workload analysis
3. **Calendar Intelligence** - Daily aggregates of tasks, capacity, and wellness metrics
4. **Wellness Recommendations** - Personalized, actionable suggestions

**Key Principle**: _Unlike standalone tools (Toggl, RescueTime, Asana), Gablura connects focus data with task management and capacity planning to prevent burnout before it happens._

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

### Benefits for Users

| User Need | How Focus Sessions Help |
|-----------|------------------------|
| **Accountability** | Visible timer + completion record prove focus time |
| **Streak Motivation** | Consecutive days builds commitment (gamification) |
| **Burnout Prevention** | Session data feeds into workload calculations |
| **Task Context** | Link sessions to tasks → understand effort per task |
| **Analytics** | See focus patterns over weeks/months |

---

## Burnout Detection Algorithm

### How It Works: The 3-Step Algorithm

#### Step 1: Daily Workload Score

```
workloadScore = (plannedHours / dailyCapacity) + (criticalTasks × 0.5) + (focusRequiredTasks × 0.3)
```

#### Step 2: Weekly Burnout Risk Assessment

| Condition | Risk Level |
|-----------|----------|
| `consecutiveHeavyDays ≥ 5` OR `avgDailyLoad > 1.5` | 🔴 CRITICAL |
| `consecutiveHeavyDays ≥ 3` OR `avgDailyLoad > 1.2` | 🟠 HIGH |
| `heavyDays ≥ 2` OR `avgDailyLoad > 1.0` | 🟡 MODERATE |
| All else | 🟢 LOW |

#### Step 3: Risk Progression Tracking

System tracks changes week-over-week to detect escalation.

---

## Calendar Intelligence System

### CalendarDayAggregate: Daily Snapshot

Every day gets a persistent record with task metrics, time metrics, and wellness metrics.

### Caching Strategy

- **Cache Key**: `calendar:aggregates:{userId}:{workspaceId}:{startDate}:{endDate}`
- **TTL**: 1 hour
- **Invalidation**: Task/focus session mutations

---

## Wellness Recommendations Engine

### 6 Recommendation Types

1. **🔴 BURNOUT_PREVENTION** (Priority: 100) - Immediate burnout alerts
2. **📈 WORKLOAD_ALERT** (Priority: 90) - Risk escalation warnings
3. **⚡ ENERGY_INSIGHT** (Priority: 70) - Energy level correlation
4. **🎯 FOCUS_SUGGESTION** (Priority: 50-60) - Focus habit building
5. **📅 SCHEDULE_ADVICE** (Priority: 75) - Capacity calibration
6. **😴 BREAK_REMINDER** (Priority: 55) - Rest day reminders

**Trigger**: Daily at **6:00 AM UTC** via cron job

---

## API Reference

### Focus Session Endpoints

#### 1. Start Focus Session
```http
POST /api/v1/focus-sessions/start
{
  "taskId": "task-123",
  "type": "POMODORO",
  "duration": 25
}
```

#### 2. Get Active Session
```http
GET /api/v1/focus-sessions/active
```

#### 3. Complete Focus Session
```http
POST /api/v1/focus-sessions/{sessionId}/complete
```

#### 4. Get Session History
```http
GET /api/v1/focus-sessions/history?limit=30
```

#### 5. Get Focus Stats
```http
GET /api/v1/focus-sessions/stats?startDate=2026-01-01&endDate=2026-01-31
```

### Burnout & Wellness Endpoints

#### 1. Get Calendar Aggregates
```http
GET /api/v1/calendar/aggregates?startDate=2026-01-01&endDate=2026-01-31
```

#### 2. Get Calendar Insights
```http
GET /api/v1/calendar/insights?startDate=2026-01-13&endDate=2026-01-19
```

#### 3. Get Wellness Recommendations
```http
GET /api/v1/calendar/recommendations
```

#### 4. Dismiss Recommendation
```http
PATCH /api/v1/calendar/recommendations/{recId}/dismiss
```

#### 5. Log Energy Level
```http
POST /api/v1/calendar/energy
{
  "date": "2026-01-15",
  "energyLevel": 7,
  "note": "Good sleep, feeling productive"
}
```

#### 6. Get Energy History
```http
GET /api/v1/calendar/energy/history?startDate=2026-01-01&endDate=2026-01-31&page=1&limit=31
```

---

## Architecture & Performance

### Optimizations

1. **Batched Aggregation** - 5 queries instead of 7×N
2. **Dual Prisma Clients** - Read replica for heavy queries
3. **Smart Caching** - 1 hour TTL with mutation invalidation
4. **Redis Deduplication** - Prevent recommendation spam

### Database Indexes

```sql
CREATE UNIQUE INDEX burnout_signal_user_week ON BurnoutSignal(userId, weekStart);
CREATE UNIQUE INDEX calendar_day_agg_user_date ON CalendarDayAggregate(userId, date);
CREATE UNIQUE INDEX energy_level_user_date ON EnergyLevel(userId, date);
CREATE INDEX focus_session_user_completed ON FocusSession(userId, completed);
CREATE INDEX focus_session_user_date ON FocusSession(userId, startedAt);
CREATE INDEX wellness_rec_user_dismissed ON WellnessRecommendation(userId, dismissed);
```

---

## Key Takeaways

| Concept | User Benefit |
|---------|---------------|
| **Focus Sessions** | Quantifiable focus + accountability |
| **Workload Score** | Mathematical burnout prediction |
| **Calendar Aggregates** | Real-time health status |
| **Burnout Signals** | Early warning system |
| **Wellness Recommendations** | Prevents burnout proactively |
| **Energy Tracking** | Correlation with workload patterns |

---

_Last Updated: January 2026_
_Gablura Backend Team_