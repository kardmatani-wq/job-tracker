# 📋 Job Tracker AI

Your personal AI-powered job application tracker with automatic resume tailoring, cover letter generation, and Google Drive integration.

---

## ✨ What it does

- **Tracks all your applications** — company, role, status, dates, salary, notes
- **AI tailors your resume** to every job description automatically
- **Generates cover letters** personalised to each role
- **Scores keyword match** so you know how strong each application is
- **Saves docs to Google Drive** directly into your Resume and Cover Letter folders
- **AI chat editor** — refine any resume or cover letter with natural language
- **Dashboard** — pipeline funnel, response rate, interview rate
- **Follow-up alerts** — highlights overdue applications

---

## 🚀 Setup Guide (about 15 minutes total)

### Step 1 — Get a Claude API Key (5 min)

1. Go to **https://console.anthropic.com**
2. Sign up / log in
3. Click **API Keys** → **Create Key**
4. Name it "Job Tracker" and copy the key — save it somewhere safe
5. Add a payment method and a small credit top-up ($5 will last a long time)

---

### Step 2 — Set up Google OAuth (5 min)

You need this so the app can read your resume and save docs to your Drive.

1. Go to **https://console.cloud.google.com**
2. Create a new project (call it "Job Tracker")
3. Go to **APIs & Services → Library**
4. Search and enable:
   - **Google Drive API**
   - **Google Docs API**
5. Go to **APIs & Services → OAuth consent screen**
   - Choose **External**
   - Fill in App name: "Job Tracker", your email for support
   - Add scopes: `../auth/drive.file` and `../auth/documents`
   - Add your own email as a test user
6. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Add Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google` (for local testing)
     - `https://YOUR-APP-NAME.vercel.app/api/auth/callback/google` (add after Vercel deploy)
7. Copy the **Client ID** and **Client Secret**

---

### Step 3 — Deploy to GitHub + Vercel (5 min)

1. Create a free account at **https://github.com** if you don't have one
2. Click **New Repository** → name it `job-tracker` → create it
3. Upload all the files from this zip to the repository (drag and drop works)
4. Create a free account at **https://vercel.com**
5. Click **Add New Project** → **Import Git Repository** → select your `job-tracker` repo
6. Before clicking Deploy, click **Environment Variables** and add:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Claude API key from Step 1 |
| `GOOGLE_CLIENT_ID` | From Step 2 |
| `GOOGLE_CLIENT_SECRET` | From Step 2 |
| `NEXTAUTH_SECRET` | Any long random string (e.g. type random gibberish) |
| `NEXTAUTH_URL` | `https://YOUR-APP-NAME.vercel.app` |

7. Click **Deploy** — Vercel builds and hosts it automatically
8. Copy your Vercel URL and go back to Google Cloud Console → add it to the OAuth redirect URIs

---

### Step 4 — First-time app setup (2 min)

1. Open your Vercel URL and bookmark it
2. Click **Connect Google Drive** and sign in
3. Go to **Settings** and:
   - Paste your base resume Google Doc URL
   - Find your **Resumes folder ID**: open the folder in Drive → copy the string after `/folders/` in the URL
   - Same for **Cover Letters folder ID**
   - Add your name and a short bio
4. You're ready to go!

---

## 💡 How to use it

**Adding a job:**
1. Click **+ New Application**
2. Paste the job posting URL (or paste the JD directly)
3. Fill in company, role, dates
4. Click **✦ Tailor & Save**
5. The AI will tailor your resume, write a cover letter, score keyword match, and save both to your Drive — all automatically

**Editing docs:**
- Open any application → click **Edit with AI** next to the resume or cover letter
- Chat naturally: "make the opening stronger", "emphasise leadership", "add more metrics"

**Tracking:**
- Update status as you progress through the pipeline
- Check off items in the Application Checklist
- Follow-up dates turn amber/red when overdue

---

## 🔧 Running locally (optional)

If you want to test before deploying:

```bash
# Copy the template and fill in your keys
cp .env.local.template .env.local

# Install dependencies
npm install

# Run locally
npm run dev
```

Then open http://localhost:3000

---

## 📁 Project structure

```
job-tracker/
├── pages/
│   ├── index.js          # Main app
│   ├── _app.js           # App wrapper
│   └── api/
│       ├── claude.js     # Claude API proxy
│       ├── drive.js      # Google Drive operations
│       └── auth/
│           └── [...nextauth].js  # Google OAuth
├── styles/
│   └── globals.css
├── .env.local.template   # Copy this to .env.local and fill in keys
├── next.config.js
└── package.json
```

---

## 🔒 Security notes

- Your **API key is stored as a server-side environment variable** — it's never exposed to the browser
- Google Drive access uses OAuth — the app only has permission to files it creates (`drive.file` scope)
- Your application data is stored in your browser's localStorage — it doesn't go to any external database

---

## ❓ Troubleshooting

**"Not authenticated with Google"** → Click Connect Google Drive in the header or Settings tab

**"Could not read base resume"** → Make sure the Google Doc is in the same Google account you signed in with, and the URL in Settings is correct

**Build fails on Vercel** → Check that all 5 environment variables are set correctly in Vercel's dashboard

**Google OAuth error** → Make sure your Vercel URL is added to the Authorized redirect URIs in Google Cloud Console
