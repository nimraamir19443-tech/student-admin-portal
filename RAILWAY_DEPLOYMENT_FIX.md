# Railway Deployment Fix Guide

## Issue
Railway was running `npx wrangler versions upload` (Cloudflare Workers command) instead of `npm start` (your Express app).

## Root Cause
The deploy command is configured in **Railway's Dashboard UI**, not in your repository files.

## Solution

### Step 1: Access Railway Dashboard
1. Go to https://railway.app/
2. Log in to your account
3. Select your **student-management-portal** project

### Step 2: Fix Deploy Settings
1. Click **Settings** (gear icon)
2. Go to **Deploy** section
3. Look for **"Deploy on Push"** or **"Build/Deploy Command"**
4. **Delete or clear** any custom deploy command (like `npx wrangler versions upload`)
5. Verify **Start Command** is: `npm start`
6. Verify **Health Check Path** is: `/health`

### Step 3: Trigger Redeploy
1. Go back to your project
2. Click **Deployments**
3. Click the "Redeploy" button on the latest deployment
4. OR: Push a new commit to GitHub: `git commit --allow-empty -m "Trigger Railway redeploy"`

## Verification

Your local app works correctly:
```
npm start
# Server running on port 3000
# GET /health returns {"status":"ok"}
```

## Current Railway Configuration (railway.json)
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "deploy": {
    "startCommand": "npm start",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100
  }
}
```

## App Details
- **Main File**: backend/server.js
- **Port**: 3000
- **Dependencies**: Express, bcryptjs, cors, pg (optional)
- **Database**: JSON file storage (no DB needed, but PostgreSQL supported)

## If Issue Persists
If Railway still tries to run wrangler after clearing dashboard settings:
1. Check if there's a GitHub Actions workflow pushing to Railway
2. Verify no environment variable like `BUILDPACK=` is set in Railway
3. Contact Railway support - they may have cached the old configuration

## Environment Variables (Optional in Railway)
- `DB_PASSWORD`: Enable PostgreSQL database
- `DB_HOST`: PostgreSQL host (default: localhost)
- `DB_USER`: PostgreSQL user (default: postgres)
- `DB_NAME`: PostgreSQL database (default: campusdesk)
- `PORT`: Server port (default: 3000, Railway overrides to 3000)

## GitHub Repository
- **URL**: https://github.com/namraamir788-pixel/student
- **Branch**: main
- **Last Commit**: cea5cf8 (Clean up Cloudflare Worker files)

## Next Steps
1. Fix Railway dashboard deploy command
2. Trigger a redeploy
3. Verify deployment succeeds (should show port 3000 running)
4. Test your live URL: `https://your-railway-url.railway.app/health`
