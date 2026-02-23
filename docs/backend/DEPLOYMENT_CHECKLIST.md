# Vercel Deployment Checklist

Use this checklist to ensure a successful deployment to Vercel.

## Pre-Deployment

### ✅ Configuration Files
- [x] `vercel.json` - Serverless configuration
- [x] `package.json` - Node.js version and scripts
- [x] `tsconfig.json` - TypeScript configuration
- [x] `prisma/schema.prisma` - Database schema with correct binaryTargets
- [x] `.vercelignore` - Files to exclude from deployment

### ✅ Application Files
- [x] `src/main.ts` - Local development server
- [x] `src/vercel.ts` - Serverless handler
- [x] `src/app.module.ts` - Main application module
- [x] All module imports are correct

### ✅ Local Testing
- [ ] Run `npm install` - Install dependencies
- [ ] Run `./test-local.sh` - Validate configuration
- [ ] Run `npm run build` - Build project successfully
- [ ] Run `npm start` - Test production build locally
- [ ] Test API endpoints locally

## Environment Variables

### Required (Production Keys)
- [ ] `DATABASE_URL` - Supabase connection pooler
- [ ] `DIRECT_URL` - Supabase direct connection  
- [ ] `CLERK_SECRET_KEY` - Production key
- [ ] `CLERK_PUBLISHABLE_KEY` - Production key
- [ ] `OPENAI_API_KEY` - Production key
- [ ] `STRIPE_SECRET_KEY` - Production key
- [ ] `STRIPE_PUBLISHABLE_KEY` - Production key
- [ ] `STRIPE_WEBHOOK_SECRET` - Production webhook secret
- [ ] `STRIPE_PRO_PRICE_ID` - Product price ID
- [ ] `STRIPE_PREMIUM_PRICE_ID` - Product price ID
- [ ] `FRONTEND_URL` - Your frontend domain (e.g., https://app.tickrify.com)

### Optional (Recommended)
- [ ] `REDIS_URL` - For async processing
- [ ] `AWS_ACCESS_KEY_ID` - For S3 file uploads
- [ ] `AWS_SECRET_ACCESS_KEY` - For S3 file uploads
- [ ] `AWS_REGION` - AWS region
- [ ] `AWS_S3_BUCKET` - S3 bucket name

### Environment Setup
- [ ] All variables added to Vercel dashboard
- [ ] Variables set for correct environment (Production/Preview)
- [ ] No test/development keys in production

## Database Setup

### Supabase Configuration
- [ ] Database created in Supabase
- [ ] Schema name is `tickrify`
- [ ] Connection pooler enabled
- [ ] Both `DATABASE_URL` and `DIRECT_URL` configured
- [ ] IP whitelist configured (if needed)

### Prisma Setup
- [ ] Run `npx prisma generate` locally
- [ ] Run `npx prisma migrate deploy` to production database
- [ ] Verify schema with `npx prisma db pull`
- [ ] Test connection with `npx prisma studio`

### Data Seeding (if needed)
- [ ] Run `npm run seed` to populate initial data
- [ ] Verify prompt configurations exist
- [ ] Check that Stripe products are set up

## Stripe Setup

### Products & Prices
- [ ] Run `npm run setup-stripe` (or use Stripe dashboard)
- [ ] Create "Pro" product with monthly price
- [ ] Create "Premium" product with monthly price
- [ ] Copy price IDs to environment variables
- [ ] Test checkout flow

### Webhooks
- [ ] Add webhook endpoint: `https://your-backend.vercel.app/api/webhooks/stripe`
- [ ] Select events:
  - [x] `checkout.session.completed`
  - [x] `customer.subscription.created`
  - [x] `customer.subscription.updated`
  - [x] `customer.subscription.deleted`
  - [x] `invoice.payment_succeeded`
  - [x] `invoice.payment_failed`
- [ ] Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET`
- [ ] Test webhook with Stripe CLI

## Clerk Setup

### Application Configuration
- [ ] Application created in Clerk
- [ ] Email/password authentication enabled
- [ ] Social login configured (if needed)
- [ ] Production keys obtained

### Webhooks
- [ ] Add webhook endpoint: `https://your-backend.vercel.app/api/webhooks/clerk`
- [ ] Select events:
  - [x] `user.created`
  - [x] `user.updated`
  - [x] `user.deleted`
- [ ] Copy webhook signing secret to `CLERK_WEBHOOK_SECRET`
- [ ] Test webhook

### Frontend Integration
- [ ] Update frontend Clerk publishable key
- [ ] Test login/logout
- [ ] Test user creation
- [ ] Verify JWT validation on backend

## Vercel Deployment

### Initial Setup
- [ ] Install Vercel CLI: `npm install -g vercel`
- [ ] Login: `vercel login`
- [ ] Link project: `vercel link`

### Preview Deployment
- [ ] Deploy to preview: `vercel`
- [ ] Test all endpoints on preview URL
- [ ] Check logs: `vercel logs [preview-url]`
- [ ] Verify no errors in Vercel dashboard

### Production Deployment
- [ ] Deploy to production: `vercel --prod`
- [ ] Save production URL
- [ ] Test all endpoints on production URL
- [ ] Monitor logs: `vercel logs --follow`

## Post-Deployment

### Frontend Configuration
- [ ] Update frontend API URL to Vercel backend
- [ ] Update CORS origin in backend (if needed)
- [ ] Test frontend → backend communication
- [ ] Verify authentication works
- [ ] Test file uploads
- [ ] Test AI analysis
- [ ] Test payments

### Webhook Verification
- [ ] Test Stripe webhook with real payment
- [ ] Test Clerk webhook with user creation
- [ ] Check webhook logs in respective dashboards
- [ ] Verify database updates from webhooks

### Monitoring Setup
- [ ] Set up Vercel alerts for errors
- [ ] Set up Vercel alerts for high response time
- [ ] Configure log retention
- [ ] Set up uptime monitoring (optional)

### Performance Check
- [ ] Test cold start time (< 3s ideal)
- [ ] Test API response times
- [ ] Check function duration in Vercel dashboard
- [ ] Verify no timeout errors
- [ ] Check memory usage

### Security Review
- [ ] No sensitive data in logs
- [ ] No API keys in code
- [ ] CORS properly configured
- [ ] Rate limiting implemented (if needed)
- [ ] Input validation working
- [ ] Error messages don't leak sensitive info

## Documentation

### Team Knowledge
- [ ] Document production URL
- [ ] Document environment variables location
- [ ] Document deployment process
- [ ] Document rollback procedure
- [ ] Share Vercel dashboard access

### User Facing
- [ ] Update API documentation
- [ ] Update integration guides
- [ ] Test API examples
- [ ] Update status page (if applicable)

## Testing Suite

### Functional Tests
- [ ] Test user registration
- [ ] Test user login
- [ ] Test image upload
- [ ] Test AI analysis
- [ ] Test subscription creation
- [ ] Test subscription cancellation
- [ ] Test webhook handling

### Edge Cases
- [ ] Test with invalid JWT
- [ ] Test with expired JWT
- [ ] Test with missing parameters
- [ ] Test with invalid file types
- [ ] Test with large files
- [ ] Test concurrent requests
- [ ] Test rate limiting (if implemented)

### Error Handling
- [ ] Test 404 responses
- [ ] Test 401 unauthorized
- [ ] Test 403 forbidden
- [ ] Test 500 internal errors
- [ ] Test timeout scenarios
- [ ] Verify error messages are user-friendly

## Rollback Plan

### If Issues Occur
- [ ] Know how to promote previous deployment
- [ ] Have backup of working environment variables
- [ ] Know how to access Vercel logs
- [ ] Have contact for Vercel support
- [ ] Can revert frontend API URL quickly

### Rollback Commands
```bash
# List deployments
vercel ls

# Promote previous deployment
vercel promote [previous-deployment-url]

# Check specific deployment logs
vercel logs [deployment-url]
```

## Success Criteria

### Must Have
- [x] Application builds successfully
- [ ] Application deploys without errors
- [ ] Health check endpoint returns 200
- [ ] Authentication works end-to-end
- [ ] Core features functional
- [ ] No critical errors in logs

### Nice to Have
- [ ] Cold start < 3 seconds
- [ ] API response time < 1 second
- [ ] Zero timeout errors
- [ ] Monitoring and alerts configured
- [ ] Comprehensive logging

## Sign-off

### Pre-Production
- [ ] Developer tested: _____________ Date: _______
- [ ] QA tested: _____________ Date: _______
- [ ] Stakeholder approved: _____________ Date: _______

### Production
- [ ] Deployed to production: _____________ Date: _______
- [ ] Smoke tests passed: _____________ Date: _______
- [ ] Monitoring confirmed: _____________ Date: _______

---

## Quick Reference

### Essential Commands
```bash
# Deploy to preview
vercel

# Deploy to production
vercel --prod

# View logs
vercel logs --follow

# List deployments
vercel ls

# Promote deployment
vercel promote [url]

# Check environment variables
vercel env ls
```

### Essential URLs
- Vercel Dashboard: https://vercel.com/dashboard
- Clerk Dashboard: https://dashboard.clerk.com
- Stripe Dashboard: https://dashboard.stripe.com
- Supabase Dashboard: https://app.supabase.com

### Support Resources
- 🚀 [QUICK_START.md](./QUICK_START.md)
- 📖 [VERCEL_DEPLOY.md](./VERCEL_DEPLOY.md)
- 🔧 [ENV_VARIABLES.md](./ENV_VARIABLES.md)
- 📋 [CHANGELOG_VERCEL.md](./CHANGELOG_VERCEL.md)

---

**Last Updated**: 2025-11-12
**Version**: 1.0.0

