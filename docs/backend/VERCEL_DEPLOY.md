# Deploying Tickrify Backend to Vercel

This guide explains how to deploy the Tickrify NestJS backend to Vercel as serverless functions.

## Architecture Overview

The backend is configured to run in two modes:

1. **Local Development**: Traditional Node.js server (runs continuously)
2. **Vercel Serverless**: Serverless functions (runs on-demand)

### Key Files for Vercel

- `src/vercel.ts` - Serverless handler for Vercel
- `src/main.ts` - Traditional server for local development
- `vercel.json` - Vercel configuration
- `package.json` - Build scripts and Node.js version

## Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **Vercel CLI** (optional): 
   ```bash
   npm install -g vercel
   ```
3. **Environment Variables**: See `ENV_VARIABLES.md` for all required variables

## Deployment Methods

### Method 1: Deploy via Vercel CLI (Recommended)

1. **Navigate to backend directory:**
   ```bash
   cd apps/backend
   ```

2. **Login to Vercel:**
   ```bash
   vercel login
   ```

3. **Link your project (first time only):**
   ```bash
   vercel link
   ```
   - Follow prompts to create/link a project
   - Choose a project name (e.g., `tickrify-backend`)

4. **Set environment variables:**
   ```bash
   vercel env add DATABASE_URL
   vercel env add DIRECT_URL
   vercel env add CLERK_SECRET_KEY
   vercel env add OPENAI_API_KEY
   vercel env add STRIPE_SECRET_KEY
   # ... add all other variables from ENV_VARIABLES.md
   ```

5. **Deploy to preview:**
   ```bash
   vercel
   ```

6. **Deploy to production:**
   ```bash
   vercel --prod
   ```

### Method 2: Deploy via GitHub Integration

1. **Push code to GitHub:**
   ```bash
   git add .
   git commit -m "Configure backend for Vercel"
   git push
   ```

2. **Import project in Vercel:**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Select your repository
   - Select "apps/backend" as the root directory
   - Framework Preset: Other
   - Build Command: `npm run vercel-build`
   - Output Directory: (leave empty)
   - Install Command: `npm install`

3. **Configure environment variables:**
   - Go to Project Settings > Environment Variables
   - Add all variables from `ENV_VARIABLES.md`
   - Make sure to set them for Production, Preview, and Development

4. **Deploy:**
   - Vercel will automatically deploy on every push to main
   - Pull requests will create preview deployments

### Method 3: Deploy via Vercel Dashboard

1. **Go to Vercel dashboard:**
   - Visit [vercel.com/dashboard](https://vercel.com/dashboard)

2. **Create new project:**
   - Click "Add New" > "Project"
   - Import from Git repository or upload files

3. **Configure project:**
   - Root Directory: `apps/backend`
   - Framework: Other
   - Build Command: `npm run vercel-build`
   - Install Command: `npm install`

4. **Add environment variables**

5. **Click Deploy**

## Configuration Details

### vercel.json Explained

```json
{
  "version": 2,
  "builds": [
    {
      "src": "dist/src/vercel.js",  // Compiled serverless handler
      "use": "@vercel/node",          // Use Node.js runtime
      "config": {
        "maxLambdaSize": "50mb",      // Increase size limit for dependencies
        "includeFiles": [              // Include Prisma files
          "dist/**",
          "prisma/**",
          "node_modules/.prisma/**",
          "node_modules/@prisma/client/**"
        ]
      }
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",             // Route /api/* to handler
      "dest": "/dist/src/vercel.js"
    },
    {
      "src": "/(.*)",                 // Route everything else to handler
      "dest": "/dist/src/vercel.js"
    }
  ],
  "functions": {
    "dist/src/vercel.js": {
      "maxDuration": 300,             // 5 minute timeout (Pro plan)
      "memory": 1024,                 // 1GB memory
      "runtime": "nodejs20.x"         // Node.js 20
    }
  }
}
```

### package.json Scripts

- `vercel-build`: Runs during Vercel deployment (generates Prisma client + builds)
- `build`: Standard build command for local/other deployments
- `start`: Runs the traditional server (local development)
- `dev`: Runs with hot reload (local development)

### How It Works

1. **Vercel detects** the `vercel.json` configuration
2. **Runs** `npm install` to install dependencies
3. **Runs** `npm run vercel-build` which:
   - Generates Prisma client
   - Compiles TypeScript to JavaScript
4. **Creates** serverless function from `dist/src/vercel.js`
5. **Routes** all requests to this function

### Serverless Handler (src/vercel.ts)

The handler:
- Uses `@vendia/serverless-express` to wrap NestJS app
- Caches the app instance (improves cold start performance)
- Handles errors gracefully
- Configures CORS for your frontend
- Returns proper HTTP responses

## Post-Deployment

### 1. Get Your API URL

After deployment, Vercel will provide a URL like:
```
https://tickrify-backend-xxxxx.vercel.app
```

### 2. Update Frontend Configuration

Update your frontend's API URL to point to the Vercel backend:

```typescript
// apps/frontend/src/lib/api.ts
const API_URL = import.meta.env.VITE_API_URL || 'https://tickrify-backend-xxxxx.vercel.app';
```

### 3. Configure Webhooks

Update webhook URLs in:
- **Clerk**: `https://tickrify-backend-xxxxx.vercel.app/api/webhooks/clerk`
- **Stripe**: `https://tickrify-backend-xxxxx.vercel.app/api/webhooks/stripe`

### 4. Test Your Deployment

```bash
# Health check
curl https://tickrify-backend-xxxxx.vercel.app/health

# Test AI endpoint
curl -X POST https://tickrify-backend-xxxxx.vercel.app/api/ai/analyze \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN" \
  -F "image=@test-chart.png"
```

### 5. Monitor Logs

```bash
# Via CLI
vercel logs

# Or visit Vercel dashboard:
# https://vercel.com/[your-team]/tickrify-backend/logs
```

## Troubleshooting

### Issue: Build Fails with Prisma Error

**Solution:**
```bash
# Make sure prisma is generated before build
npm run vercel-build
```

Check that `vercel-build` script includes `prisma generate`.

### Issue: Function Times Out

**Causes:**
- AI processing takes too long
- Database queries are slow
- Cold start takes too long

**Solutions:**
1. Upgrade to Vercel Pro for 60s timeout (or 300s with config)
2. Use Redis/BullMQ for async processing
3. Optimize database queries
4. Use smaller OpenAI models or reduce max_tokens

### Issue: CORS Errors

**Solution:**
Make sure `FRONTEND_URL` environment variable matches your frontend domain exactly:
```bash
vercel env add FRONTEND_URL production
# Enter: https://your-frontend-domain.vercel.app
```

### Issue: Prisma Client Not Found

**Solution:**
The `vercel.json` config already includes Prisma files. If still issues:

1. Check `includeFiles` in `vercel.json`
2. Verify `binaryTargets` in `prisma/schema.prisma`:
   ```prisma
   binaryTargets = ["native", "debian-openssl-1.1.x"]
   ```
3. Run `prisma generate` locally and check output

### Issue: Environment Variables Not Working

**Solution:**
1. Check spelling of variable names
2. Verify variables are set for correct environment (Production/Preview/Development)
3. Redeploy after adding new variables:
   ```bash
   vercel --prod --force
   ```

### Issue: 500 Internal Server Error

**Check logs:**
```bash
vercel logs --follow
```

Common causes:
- Missing environment variables
- Database connection issues
- Prisma client not generated
- Module import errors

## Performance Optimization

### 1. Enable Caching

The serverless handler already caches the NestJS app instance:
```typescript
let cachedServer: any;
// Reuses same instance across invocations
```

### 2. Database Connection Pooling

Use Supabase's connection pooler (already configured):
```bash
DATABASE_URL=postgresql://...supabase.co:6543/...?pgbouncer=true
```

### 3. Redis for Job Queue

For long-running AI tasks, use Redis/BullMQ:
```bash
# Use Upstash Redis (serverless-compatible)
REDIS_URL=redis://...upstash.io:...
```

### 4. Optimize Dependencies

Reduce bundle size:
```bash
# Analyze bundle
npm run build
ls -lh dist/
```

### 5. Use Edge Functions (Advanced)

For faster response times, consider Edge Functions for simple endpoints:
```typescript
// src/edge/health.ts
export const config = { runtime: 'edge' };
export default function handler() {
  return new Response('OK');
}
```

## Monitoring & Debugging

### View Logs
```bash
vercel logs [deployment-url]
```

### View Metrics
Visit Vercel dashboard:
- Function executions
- Duration
- Errors
- Cache hits

### Add Custom Logging
```typescript
console.log('Info:', { userId, action });
console.error('Error:', error);
console.warn('Warning:', message);
```

## Rollback

If something goes wrong:

```bash
# List deployments
vercel ls

# Promote a previous deployment
vercel promote [deployment-url]
```

Or in Vercel dashboard:
- Go to Deployments
- Find working deployment
- Click "..." > "Promote to Production"

## Best Practices

1. ✅ **Always test locally first**
   ```bash
   npm run build && npm start
   ```

2. ✅ **Use preview deployments** for testing
   ```bash
   vercel  # Creates preview
   # Test, then:
   vercel --prod  # Promote to production
   ```

3. ✅ **Monitor logs** after deployment
   ```bash
   vercel logs --follow
   ```

4. ✅ **Set up alerts** in Vercel dashboard
   - Error rate > threshold
   - Function duration > threshold

5. ✅ **Use environment-specific variables**
   - Development: test keys
   - Preview: test keys
   - Production: production keys

6. ✅ **Keep secrets secure**
   - Never commit `.env` files
   - Use Vercel's environment variables
   - Rotate keys regularly

## Cost Considerations

### Vercel Hobby Plan (Free)
- 100GB bandwidth/month
- 100 serverless function executions/day
- 10s function timeout

### Vercel Pro Plan ($20/month)
- 1TB bandwidth/month
- Unlimited executions
- 60s timeout (300s configurable)
- Team collaboration

### Tips to Reduce Costs
1. Cache aggressively
2. Optimize function duration
3. Use Edge Functions for simple endpoints
4. Implement request batching
5. Use CDN for static assets

## Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [NestJS Serverless](https://docs.nestjs.com/faq/serverless)
- [Prisma on Vercel](https://www.prisma.io/docs/guides/deployment/deployment-guides/deploying-to-vercel)
- [Vercel CLI Reference](https://vercel.com/docs/cli)

## Support

If you encounter issues:

1. Check Vercel logs
2. Review this documentation
3. Check `ENV_VARIABLES.md`
4. Search [Vercel Community](https://github.com/vercel/vercel/discussions)
5. Open an issue in the project repository

