# Tickrify Backend - Vercel Deployment Setup

## Quick Start

This backend is configured to run both **locally** and on **Vercel serverless**.

### Local Development
```bash
cd apps/backend
npm install
npm run dev
```

### Vercel Deployment
```bash
cd apps/backend
vercel --prod
```

## File Structure

```
apps/backend/
├── src/
│   ├── main.ts          # Local development server
│   ├── vercel.ts        # Serverless handler for Vercel
│   ├── app.module.ts    # Main NestJS module
│   └── modules/         # Feature modules
├── prisma/
│   └── schema.prisma    # Database schema
├── vercel.json          # Vercel configuration
├── package.json         # Dependencies & scripts
├── ENV_VARIABLES.md     # Environment variables guide
└── VERCEL_DEPLOY.md     # Detailed deployment guide
```

## How It Works

### Local Mode (`npm run dev`)
- Uses `src/main.ts`
- Runs as traditional Node.js server
- Listens on port 3001 (configurable)
- Hot reload enabled

### Vercel Mode (`vercel --prod`)
- Uses `src/vercel.ts`
- Runs as serverless function
- Auto-scales on demand
- No persistent server

## Key Differences

| Feature | Local | Vercel |
|---------|-------|--------|
| Entry Point | `main.ts` | `vercel.ts` |
| Server Type | Long-running | Serverless |
| Scaling | Manual | Automatic |
| Timeout | None | 10s (Hobby) / 60s (Pro) |
| State | Persistent | Stateless (cached) |

## Configuration Files

### 1. vercel.json
Tells Vercel how to build and run the app:
- Builds `dist/src/vercel.js` as serverless function
- Routes all requests to this function
- Includes Prisma files in deployment
- Sets 5-minute timeout (requires Pro plan)

### 2. package.json
Key scripts:
- `dev`: Local development with hot reload
- `build`: Build TypeScript to JavaScript
- `vercel-build`: Build for Vercel (includes Prisma generation)
- `start`: Run production build locally

### 3. prisma/schema.prisma
Configured for Vercel:
```prisma
binaryTargets = ["native", "debian-openssl-1.1.x"]
```

## Environment Variables

See `ENV_VARIABLES.md` for complete list.

**Required:**
- `DATABASE_URL` - Supabase PostgreSQL (connection pooler)
- `DIRECT_URL` - Supabase PostgreSQL (direct connection)
- `CLERK_SECRET_KEY` - Authentication
- `OPENAI_API_KEY` - AI analysis
- `STRIPE_SECRET_KEY` - Payments
- `FRONTEND_URL` - CORS configuration

## Deployment Checklist

- [ ] All environment variables set in Vercel
- [ ] `FRONTEND_URL` matches your frontend domain
- [ ] Database migrations run (`prisma migrate deploy`)
- [ ] Stripe products/prices created
- [ ] Webhook URLs updated (Clerk, Stripe)
- [ ] Test endpoints after deployment

## Testing Deployment

### 1. Local Test
```bash
npm run build
npm start
# Test on http://localhost:3001
```

### 2. Vercel Preview
```bash
vercel
# Test on preview URL
```

### 3. Production
```bash
vercel --prod
# Test on production URL
```

### 4. Health Check
```bash
curl https://your-backend.vercel.app/health
```

## Common Issues

### Build Fails
```bash
# Clear cache and rebuild
rm -rf dist node_modules .next
npm install
npm run build
```

### Prisma Issues
```bash
# Regenerate Prisma client
npx prisma generate
npm run build
```

### CORS Errors
Check `FRONTEND_URL` environment variable matches your frontend exactly.

### Timeout Errors
- Optimize database queries
- Use smaller AI models
- Consider upgrading to Vercel Pro
- Implement async processing with Redis/BullMQ

## Monitoring

### View Logs
```bash
vercel logs --follow
```

### View Dashboard
https://vercel.com/dashboard

### Metrics to Watch
- Function duration
- Error rate
- Invocation count
- Cold starts

## Support

- 📖 [Detailed Deployment Guide](./VERCEL_DEPLOY.md)
- 🔧 [Environment Variables](./ENV_VARIABLES.md)
- 📝 [NestJS Documentation](https://docs.nestjs.com)
- 🚀 [Vercel Documentation](https://vercel.com/docs)

## Quick Commands

```bash
# Install dependencies
npm install

# Local development
npm run dev

# Build project
npm run build

# Run production locally
npm start

# Deploy to preview
vercel

# Deploy to production
vercel --prod

# View logs
vercel logs

# List deployments
vercel ls

# Check environment variables
vercel env ls
```

---

**Ready to deploy?** Follow the [Complete Deployment Guide](./VERCEL_DEPLOY.md)

