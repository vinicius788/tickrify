# Environment Variables Configuration

## Required Environment Variables

This document lists all environment variables required for the Tickrify backend to function properly.

### Node Environment
```bash
NODE_ENV=development  # or 'production' for Vercel deployment
```

### Server Configuration
```bash
PORT=3001  # Port for local development (not used in Vercel)
FRONTEND_URL=http://localhost:5173  # Frontend URL for CORS
```

### Database Configuration (Supabase PostgreSQL)
```bash
# Direct URL for migrations and local development
DATABASE_URL=postgresql://user:password@host:port/database?schema=tickrify

# Connection pooling URL for production (Supabase)
DIRECT_URL=postgresql://user:password@host:port/database?schema=tickrify
```

**Getting Supabase URLs:**
1. Go to your Supabase project dashboard
2. Navigate to Settings > Database
3. Copy "Connection string" for DATABASE_URL (use connection pooler)
4. Copy "Direct connection" for DIRECT_URL

### Clerk Authentication
```bash
CLERK_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY_HERE
CLERK_SECRET_KEY=YOUR_SECRET_KEY_HERE
CLERK_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET_HERE
```

**Getting Clerk keys:**
1. Visit [Clerk Dashboard](https://dashboard.clerk.com)
2. Select your application
3. Go to API Keys section
4. For webhook secret, create a webhook endpoint first

### OpenAI API
```bash
OPENAI_API_KEY=YOUR_OPENAI_API_KEY_HERE
```

**Getting OpenAI key:**
1. Visit [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create a new API key
3. Make sure you have credits or a payment method configured

### Stripe Payment Processing
```bash
STRIPE_SECRET_KEY=YOUR_SECRET_KEY_HERE
STRIPE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY_HERE
STRIPE_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET_HERE

# Product/Price IDs (after running setup script)
STRIPE_PRO_PRICE_ID=price_xxxxx
STRIPE_PREMIUM_PRICE_ID=price_xxxxx
```

**Getting Stripe keys:**
1. Visit [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
2. Copy API keys (use test keys for development)
3. For webhook secret, create a webhook endpoint
4. Run the product setup script to get Price IDs

### AWS S3 Configuration (Optional)
```bash
AWS_ACCESS_KEY_ID=xxxxx
AWS_SECRET_ACCESS_KEY=xxxxx
AWS_REGION=us-east-1
AWS_S3_BUCKET=tickrify-uploads
```

**Note:** If not configured, the backend will use local file storage.

### Redis Configuration (Optional)
```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_URL=redis://localhost:6379
```

**Note:** If not configured, AI processing will be synchronous (may timeout on Vercel's 300s limit for hobby plan).

---

## Vercel Deployment

### Setting Environment Variables on Vercel

1. Go to your Vercel project dashboard
2. Navigate to Settings > Environment Variables
3. Add each variable from above
4. Set the appropriate environment (Production, Preview, Development)

### Important Notes for Vercel

1. **Use Production Keys**: When deploying to production, use production keys from Clerk, Stripe, and OpenAI

2. **Database URLs**: 
   - `DATABASE_URL` should point to Supabase connection pooler (for serverless)
   - `DIRECT_URL` should point to direct connection (used by Prisma for migrations)

3. **Frontend URL**: Set this to your actual frontend domain:
   ```bash
   FRONTEND_URL=https://your-frontend-domain.vercel.app
   ```

4. **Redis/BullMQ**: 
   - Optional but recommended for async AI processing
   - Use Upstash Redis for serverless compatibility
   - Visit [Upstash](https://upstash.com) to create a free Redis instance

5. **Function Timeout**:
   - Free/Hobby plan: 10s timeout
   - Pro plan: 60s timeout (can be extended to 300s)
   - Make sure your AI processing completes within timeout

### Prisma Configuration

The backend is already configured for Vercel with the correct binary targets in `prisma/schema.prisma`:

```prisma
generator client {
  provider        = "prisma-client-js"
  binaryTargets   = ["native", "debian-openssl-1.1.x"]
}
```

This ensures Prisma works on both your local machine and Vercel's serverless environment.

---

## Local Development

Create a `.env` file in the `apps/backend` directory with all the variables above:

```bash
cp ENV_VARIABLES.md .env
# Edit .env with your actual values
```

Then run:
```bash
npm install
npm run dev
```

---

## Testing the Configuration

After setting all environment variables:

1. **Test locally:**
   ```bash
   cd apps/backend
   npm run dev
   ```

2. **Test Prisma connection:**
   ```bash
   npx prisma db pull
   ```

3. **Deploy to Vercel:**
   ```bash
   vercel --prod
   ```

4. **Check Vercel logs:**
   ```bash
   vercel logs
   ```

---

## Troubleshooting

### Database Connection Issues
- Verify DATABASE_URL and DIRECT_URL are correct
- Check if your IP is whitelisted in Supabase (if using direct connection)
- For serverless, always use connection pooler

### CORS Issues
- Make sure FRONTEND_URL matches your actual frontend domain
- Check Vercel logs for CORS-related errors

### Prisma Issues
- Run `npx prisma generate` after any schema changes
- For Vercel, the `vercel-build` script handles this automatically

### Timeout Issues
- If AI processing times out, consider using Redis/BullMQ
- Or upgrade to Vercel Pro for longer function timeouts
- Optimize OpenAI API calls (use lower max_tokens, faster models)

