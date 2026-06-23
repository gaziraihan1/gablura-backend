# 🚀 Focura Backend Deployment Guide

A complete production deployment guide for the Focura Backend API.

## Overview

This guide covers:

- Environment configuration
- PostgreSQL setup
- Redis & Upstash configuration
- Railway deployment
- Docker deployment
- Kubernetes deployment
- AWS ECS deployment
- Monitoring & logging
- Scaling strategies
- Rollback procedures

---

## Prerequisites

Before deploying, ensure:

- Node.js 20+ installed
- PostgreSQL database available
- Redis / Upstash configured
- Environment variables prepared
- Production domain configured
- SSL certificates ready

---

## Pre-Deployment Checklist

### Application

- [ ] All tests passing
- [ ] TypeScript build successful
- [ ] Security audit completed
- [ ] Code reviewed and approved
- [ ] Release tag created

### Infrastructure

- [ ] Database backups created
- [ ] Redis configured
- [ ] Health endpoint verified
- [ ] SSL enabled
- [ ] Monitoring configured

---

## Environment Variables

Create production environment variables in your hosting provider.

### Required Variables

```env
NODE_ENV=production
PORT=5000

ALLOWED_ORIGIN=https://app.focura.com
CLIENT_URL=https://app.focura.com
BACKEND_URL=https://api.focura.com

DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

NEXTAUTH_SECRET=your-secret

JWT_PRIVATE_KEY=...
JWT_PUBLIC_KEY=...

UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

REDIS_URL=rediss://...
```

---

## Database Setup

### Run Migrations

```bash
npx prisma migrate deploy
```

### Verify Database

```bash
npx prisma studio
```

### Connection Pool Formula

```text
(max_connections - 3) / number_of_instances
```

---

## Railway Deployment

Recommended for startups and MVPs.

### Steps

1. Push code to GitHub
2. Create Railway project
3. Connect repository
4. Add PostgreSQL service
5. Configure environment variables
6. Deploy

### railway.json

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "nixpacks"
  },
  "deploy": {
    "startCommand": "npm start"
  }
}
```

---

## Docker Deployment

### Build

```bash
docker build -t focura-backend .
```

### Run

```bash
docker run -p 5000:5000 focura-backend
```

---

## Kubernetes Deployment

Key recommendations:

- Minimum 3 replicas
- Health checks enabled
- Resource limits configured
- Secrets managed through Kubernetes Secrets

Deploy:

```bash
kubectl apply -f k8s/deployment.yaml
```

---

## AWS ECS Deployment

Recommended for scalable production workloads.

### Features

- Fargate support
- Auto scaling
- CloudWatch logging
- Secrets Manager integration

---

## Post Deployment Verification

### Health Check

```bash
curl https://api.focura.com/health
```

### Verify Database

```bash
SELECT COUNT(*) FROM "User";
```

### Verify Redis

```bash
PING
```

---

## Monitoring

Recommended tools:

- Sentry
- Datadog
- New Relic

Monitor:

- API latency
- Error rate
- Database health
- Redis health
- CPU usage
- Memory usage

---

## Rollback Strategy

### Railway

Redeploy a previous successful deployment.

### Kubernetes

```bash
kubectl rollout undo deployment/focura-backend
```

### AWS ECS

Update the service to a previous task definition revision.

---

## Scaling

### Application

- Horizontal scaling
- Load balancing
- Stateless services

### Database

- Read replicas
- Connection pooling
- Index optimization

### Cache

- Upstash Redis
- Distributed pub/sub
- Rate limiting

---

## Deployment Checklist

| Task | Status |
|--------|--------|
| Tests Passing | ⬜ |
| Security Audit | ⬜ |
| Environment Configured | ⬜ |
| Database Backed Up | ⬜ |
| Migrations Applied | ⬜ |
| Deployment Complete | ⬜ |
| Health Checks Passing | ⬜ |
| Monitoring Active | ⬜ |

---

## Troubleshooting

### Check Logs

```bash
railway logs
```

```bash
kubectl logs deployment/focura-backend
```

```bash
docker logs <container-id>
```

### Common Issues

1. Missing environment variables
2. Database connection failures
3. Redis connectivity issues
4. SSL certificate problems
5. Firewall or security group restrictions

---

## Support

If deployment fails:

1. Verify environment variables
2. Check application logs
3. Confirm database connectivity
4. Verify Redis connection
5. Review SSL configuration

---

Built for the **Focura Backend** project.
