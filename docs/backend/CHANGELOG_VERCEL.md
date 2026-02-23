# Changelog - Vercel Configuration

## Summary of Changes

This document lists all changes made to configure the backend for Vercel serverless deployment.

## Files Created/Updated

### ✅ Created Files

1. **vercel.json** (updated)
   - Clean configuration for Vercel serverless functions
   - Routes all requests to `dist/src/vercel.js`
   - Includes Prisma files in deployment
   - Sets 300s timeout and 1024MB memory
   - Uses Node.js 20.x runtime

2. **ENV_VARIABLES.md** (new)
   - Complete list of required environment variables
   - Instructions for getting API keys
   - Vercel-specific configuration notes
   - Troubleshooting tips

3. **VERCEL_DEPLOY.md** (new)
   - Complete deployment guide
   - Three deployment methods (CLI, GitHub, Dashboard)
   - Detailed configuration explanations
   - Post-deployment checklist
   - Troubleshooting section
   - Performance optimization tips
   - Cost considerations

4. **README_VERCEL.md** (new)
   - Quick start guide
   - File structure overview
   - Key differences between local and Vercel
   - Configuration files explained
   - Common issues and solutions
   - Quick command reference

5. **test-local.sh** (new)
   - Automated testing script
   - Validates configuration before deployment
   - Checks Node.js version
   - Verifies environment variables
   - Tests database connection
   - Builds project
   - Validates build outputs

### ✅ Updated Files

1. **src/vercel.ts** (improved)
   - Added comprehensive error handling
   - Improved CORS configuration with origin validation
   - Added request/response logging
   - Better serverless context handling
   - Graceful error responses
   - Extensive code documentation

2. **src/main.ts** (improved)
   - Added error handling for bootstrap
   - Improved CORS configuration
   - Added startup logging
   - Better validation pipe configuration
   - Only runs when executed directly
   - Works with both local and production

3. **package.json** (updated)
   - Added `engines.node` specification (>=18.x)
   - Added `vercel-build` script for Vercel
   - Updated `start` script to use compiled code

## Configuration Details

### Vercel Configuration (vercel.json)

```json
{
  "version": 2,
  "builds": [{
    "src": "dist/src/vercel.js",
    "use": "@vercel/node",
    "config": {
      "maxLambdaSize": "50mb",
      "includeFiles": [
        "dist/**",
        "prisma/**",
        "node_modules/.prisma/**",
        "node_modules/@prisma/client/**"
      ]
    }
  }],
  "routes": [
    { "src": "/api/(.*)", "dest": "/dist/src/vercel.js" },
    { "src": "/(.*)", "dest": "/dist/src/vercel.js" }
  ],
  "functions": {
    "dist/src/vercel.js": {
      "maxDuration": 300,
      "memory": 1024,
      "runtime": "nodejs20.x"
    }
  }
}
```

### Key Features

1. **Serverless Handler (vercel.ts)**
   - Server instance caching for better cold start performance
   - Environment-aware CORS configuration
   - Global validation pipes
   - Comprehensive error handling
   - Proper serverless context management

2. **Local Development (main.ts)**
   - Traditional Node.js server
   - Hot reload support
   - Better logging
   - Same CORS and validation as serverless

3. **Build Process**
   - `npm run build`: Standard build
   - `npm run vercel-build`: Includes Prisma generation
   - Both produce serverless-compatible output

## Removed Configurations

The following Railway/Docker-specific configurations were identified but **not removed** as they don't conflict with Vercel:

- `Dockerfile` - Can coexist, used for Docker deployments
- `Dockerfile.worker` - Separate worker container
- `railway.json` - Railway-specific, ignored by Vercel
- `fly.toml` - Fly.io specific, ignored by Vercel

These files remain for multi-platform deployment flexibility.

## Compatibility

### ✅ Works with:
- Vercel Serverless Functions
- Local development (traditional Node.js)
- Docker containers
- Railway
- Fly.io
- Any Node.js hosting platform

### ⚠️ Notes:
- **BullMQ/Redis**: Optional for async processing
  - Without Redis: Synchronous processing (may timeout)
  - With Redis: Async processing (recommended)
- **File Uploads**: Should use S3 or similar (local storage not persistent)
- **WebSockets**: Not supported in Vercel serverless (use different provider)

## Testing

### Before Deployment

```bash
# Run test script
cd apps/backend
./test-local.sh

# Or manually:
npm install
npm run build
npm start

# Test endpoint
curl http://localhost:3001/health
```

### After Deployment

```bash
# Deploy to preview
vercel

# Test preview
curl https://preview-url.vercel.app/health

# Deploy to production
vercel --prod

# Test production
curl https://production-url.vercel.app/health
```

## Environment Variables Checklist

Required for Vercel:
- [ ] `DATABASE_URL` - Supabase connection pooler
- [ ] `DIRECT_URL` - Supabase direct connection
- [ ] `CLERK_SECRET_KEY` - Authentication
- [ ] `CLERK_PUBLISHABLE_KEY` - Client-side auth
- [ ] `OPENAI_API_KEY` - AI processing
- [ ] `STRIPE_SECRET_KEY` - Payments
- [ ] `STRIPE_WEBHOOK_SECRET` - Stripe webhooks
- [ ] `FRONTEND_URL` - Your frontend domain

Optional but recommended:
- [ ] `REDIS_URL` - For async processing
- [ ] `AWS_ACCESS_KEY_ID` - For S3 uploads
- [ ] `AWS_SECRET_ACCESS_KEY` - For S3 uploads
- [ ] `AWS_S3_BUCKET` - For S3 uploads

## Deployment Workflow

1. **Develop locally**
   ```bash
   npm run dev
   ```

2. **Test build**
   ```bash
   ./test-local.sh
   ```

3. **Deploy to preview**
   ```bash
   vercel
   ```

4. **Test preview deployment**
   ```bash
   curl https://preview-url.vercel.app/health
   ```

5. **Deploy to production**
   ```bash
   vercel --prod
   ```

6. **Monitor logs**
   ```bash
   vercel logs --follow
   ```

## Performance Considerations

### Cold Start Optimization
- Server instance caching implemented
- Minimal imports in vercel.ts
- Prisma client pre-generated

### Memory Usage
- Set to 1024MB (adjustable)
- Monitor with Vercel dashboard
- Optimize if needed

### Timeout Configuration
- Set to 300s (requires Pro plan)
- Hobby plan: 10s limit
- Consider async processing for long tasks

### Database Connection
- Using Supabase connection pooler
- Supports serverless architecture
- Auto-scaling connections

## Migration Path

If upgrading from Railway/other platforms:

1. ✅ Keep existing code (no breaking changes)
2. ✅ Add Vercel configuration files
3. ✅ Set environment variables in Vercel
4. ✅ Deploy to Vercel
5. ✅ Update frontend to point to Vercel backend
6. ✅ Update webhook URLs (Clerk, Stripe)
7. ✅ Test thoroughly
8. ✅ Switch DNS/domain if needed
9. ✅ Decommission old platform

## Rollback Plan

If issues occur:

1. **Quick rollback**: Promote previous Vercel deployment
   ```bash
   vercel ls
   vercel promote [previous-deployment-url]
   ```

2. **Full rollback**: Revert frontend API URL to old backend

3. **Investigation**: Check Vercel logs
   ```bash
   vercel logs [deployment-url]
   ```

## Support Resources

- 📖 [ENV_VARIABLES.md](./ENV_VARIABLES.md) - Environment setup
- 🚀 [VERCEL_DEPLOY.md](./VERCEL_DEPLOY.md) - Deployment guide
- 📝 [README_VERCEL.md](./README_VERCEL.md) - Quick reference
- 🧪 Testes locais manuais (veja a seção `Testing` neste documento)

## Next Steps

1. Review all documentation files
2. Set up environment variables in Vercel
3. Run local tests with `./test-local.sh`
4. Deploy to preview environment
5. Test all endpoints
6. Deploy to production
7. Monitor logs and metrics

## Version

- Configuration Version: 1.0.0
- Created: 2025-11-12
- Node.js: >=18.x
- NestJS: ^10.0.0
- Vercel Runtime: nodejs20.x

---

**Status**: ✅ Ready for Vercel deployment

**Last Updated**: 2025-11-12
