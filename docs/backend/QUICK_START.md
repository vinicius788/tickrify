# Quick Start Guide - Vercel Deployment

## 🚀 Deploy to Vercel in 5 Minutes

### Prerequisites
- ✅ Node.js >= 18.x installed
- ✅ Vercel account ([sign up](https://vercel.com/signup))
- ✅ Database ready (Supabase recommended)
- ✅ API keys (Clerk, OpenAI, Stripe)

---

## Step 1: Install Vercel CLI

```bash
npm install -g vercel
```

---

## Step 2: Navigate to Backend

```bash
cd apps/backend
```

---

## Step 3: Test Locally (Optional but Recommended)

```bash
# Install dependencies
npm install

# Run test script
./test-local.sh

# Or test manually
npm run build
npm start
```

---

## Step 4: Login to Vercel

```bash
vercel login
```

---

## Step 5: Deploy to Preview

```bash
vercel
```

Follow the prompts:
- **Set up and deploy?** → Yes
- **Which scope?** → Your account/team
- **Link to existing project?** → No
- **Project name?** → tickrify-backend (or your choice)
- **Directory?** → ./ (current directory)
- **Override settings?** → No

---

## Step 6: Add Environment Variables

### Option A: Via CLI (Interactive)
```bash
vercel env add DATABASE_URL production
# Paste your database URL when prompted
# Repeat for each variable
```

### Option B: Via Dashboard
1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to Settings → Environment Variables
4. Add all variables from `ENV_VARIABLES.md`

**Required Variables:**
```bash
DATABASE_URL
DIRECT_URL
CLERK_SECRET_KEY
CLERK_PUBLISHABLE_KEY
OPENAI_API_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
FRONTEND_URL
```

---

## Step 7: Deploy to Production

```bash
vercel --prod
```

---

## Step 8: Test Deployment

```bash
# Replace with your actual Vercel URL
curl https://tickrify-backend.vercel.app/health
```

Expected response:
```json
{"status":"ok"}
```

---

## Step 9: Update Frontend

Update your frontend's API URL to point to Vercel:

```typescript
// apps/frontend/src/lib/api.ts
const API_URL = 'https://tickrify-backend.vercel.app';
```

---

## Step 10: Update Webhooks

### Clerk Webhook
1. Go to [Clerk Dashboard](https://dashboard.clerk.com)
2. Navigate to Webhooks
3. Add endpoint: `https://tickrify-backend.vercel.app/api/webhooks/clerk`

### Stripe Webhook
1. Go to [Stripe Dashboard](https://dashboard.stripe.com/webhooks)
2. Add endpoint: `https://tickrify-backend.vercel.app/api/webhooks/stripe`
3. Select events: `checkout.session.completed`, `customer.subscription.updated`, etc.

---

## 🎉 Done!

Your backend is now live on Vercel!

---

## 📊 Monitor Your Deployment

### View Logs
```bash
vercel logs --follow
```

### View Dashboard
Visit: https://vercel.com/dashboard

### View Deployments
```bash
vercel ls
```

---

## 🔧 Common Commands

```bash
# Deploy to preview
vercel

# Deploy to production
vercel --prod

# View logs
vercel logs

# View logs (follow mode)
vercel logs --follow

# List deployments
vercel ls

# List environment variables
vercel env ls

# Pull environment variables locally
vercel env pull

# Remove deployment
vercel rm [deployment-url]

# Promote deployment to production
vercel promote [deployment-url]

# Open project in browser
vercel
```

---

## 🐛 Troubleshooting

### Build Failed?
```bash
# Check build locally first
npm run build

# Check logs
vercel logs [deployment-url]
```

### Database Connection Failed?
- Verify `DATABASE_URL` is correct
- Use connection pooler URL (not direct)
- Check if IP whitelisting is needed

### CORS Errors?
- Verify `FRONTEND_URL` matches your frontend domain exactly
- Include protocol (https://)
- No trailing slash

### Function Timeout?
- Optimize slow queries
- Use smaller AI models
- Consider Redis for async processing
- Upgrade to Vercel Pro (60s timeout)

### Environment Variables Not Working?
```bash
# List all environment variables
vercel env ls

# Redeploy after adding variables
vercel --prod --force
```

---

## 📚 More Information

- 📖 **Complete Guide**: [VERCEL_DEPLOY.md](./VERCEL_DEPLOY.md)
- 🔧 **Environment Variables**: [ENV_VARIABLES.md](./ENV_VARIABLES.md)
- 📝 **Configuration**: [README_VERCEL.md](./README_VERCEL.md)
- 📋 **Changelog**: [CHANGELOG_VERCEL.md](./CHANGELOG_VERCEL.md)

---

## 🆘 Need Help?

1. **Check logs**: `vercel logs`
2. **Review documentation**: Files listed above
3. **Vercel Support**: [vercel.com/support](https://vercel.com/support)
4. **Community**: [github.com/vercel/vercel/discussions](https://github.com/vercel/vercel/discussions)

---

## ✨ Pro Tips

1. **Always test locally** before deploying:
   ```bash
   ./test-local.sh
   ```

2. **Use preview deployments** for testing:
   ```bash
   vercel  # Deploy to preview first
   # Test thoroughly
   vercel --prod  # Then deploy to production
   ```

3. **Monitor your logs** after deployment:
   ```bash
   vercel logs --follow
   ```

4. **Set up notifications** in Vercel dashboard for errors

5. **Use Git integration** for automatic deployments on push

---

**Happy Deploying! 🚀**

