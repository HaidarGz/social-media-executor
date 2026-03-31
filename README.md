# 🚀 Stealth Social Media Automation API

A robust, headless browser automation API designed to bridge workflow tools like **n8n** (or Make, Zapier, custom scripts) with social media platforms. 

By utilizing **Playwright** and **Session Cookies**, this API bypasses the strict limitations of official social media APIs, allowing you to post directly to **Instagram, TikTok, X (Twitter), and Threads** as if you were doing it manually from a browser.

---

## ✨ Key Features
* **Multi-Platform Routing:** One endpoint handles posts for Instagram, TikTok, Threads, and X.
* **TikTok Auto-Converter:** TikTok only accepts videos. If you send a `.jpg` to this API for TikTok, it uses `ffmpeg` to automatically convert the image into a 15-second `.mp4` video and attaches a random background track from your `music/` folder.
* **Smart Content Limits:** Automatically truncates text to fit platform limits (280 characters for X, 500 characters for Threads) to prevent crash errors.
* **Stealth Mode:** Uses custom User-Agents, native React clipboard pasting, and randomized delays to mimic human behavior and minimize bot detection.
* **Dynamic Media Handling:** Downloads media temporarily, posts it, and deletes the file instantly to save server space.

---

## 🛠️ Prerequisites
Before deploying, you will need:
1. A [Supabase](https://supabase.com/) account (Free tier is perfect).
2. A [Railway.app](https://railway.app/) account for hosting.
3. The [EditThisCookie](https://chrome.google.com/webstore/detail/editthiscookie/fngmhnnpilhplaeedifhccceomclgfbg) extension installed in Google Chrome.

---

## 📖 Complete Setup Guide

### Step 1: Database Setup (Supabase)
We use Supabase (PostgreSQL) to store your active browser session cookies securely. The bot reads this database to know "who" it is logging in as.

1. Create a new project in Supabase.
2. Navigate to the **SQL Editor** in the left-hand menu.
3. Paste and run the following SQL command to create the required table:

```sql
CREATE TABLE social_cookies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  friend_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  cookie_json JSONB NOT NULL,
  last_updated TIMESTAMPTZ DEFAULT now(),
  UNIQUE(friend_name, platform)
);


Step 2: Extracting Your Cookies
The bot needs your browser cookies to post without triggering login screens or 2FA checks.

Install the EditThisCookie Chrome extension.

Open an Incognito/Private window and log into the social media account you want to automate (e.g., instagram.com).

Once fully logged in, click the EditThisCookie puzzle piece icon in your browser toolbar.

Click the Export button (the icon that looks like a right-pointing arrow: ]→). Your cookies are now copied to your clipboard as JSON.

Go to your Supabase social_cookies table and click Insert Row:

friend_name: Think of this as the "Account ID". Give it a memorable placeholder name (e.g., my_brand_insta, client_account_x). You will use this exact name in your API requests later.

platform: You MUST use one of these exact lowercase words: instagram, tiktok, threads, or x.

cookie_json: Paste the JSON data you just copied from EditThisCookie.

(Note: If your bot fails to post after a few weeks, your session cookies likely expired. Simply log in again, export the fresh cookies, and update the cookie_json cell in Supabase).

Step 3: Add Background Music (For TikTok)
If you plan to post images to TikTok, the bot needs audio to convert them into videos.

In this repository, open the music/ folder.

Upload 3 to 5 small .mp3 files (copyright-free music is recommended).

The bot will randomly select one of these tracks every time it builds a TikTok video.

Step 4: Deployment (Railway)
This script relies on Docker to install Chromium browsers and FFmpeg. Railway handles this automatically.

Create an account on .

Click + New Project -> Deploy from GitHub repo and select your fork of this repository.

While it builds, click on the service, go to the Variables tab, and add your Supabase credentials:

SUPABASE_URL: Your Supabase Project URL (found in Supabase Settings -> API).

SUPABASE_ANON_KEY: Your Supabase anon public key.

Go to the Settings tab in Railway, find the Networking section, and click Generate Domain. This is your API URL.

🚀 How to use it (n8n Integration)
To trigger a post, you need to send an HTTP POST request to your Railway URL.

If you are using n8n, use the HTTP Request Node:

Method: POST

URL: https://your-railway-app.up.railway.app/publish

Body Content Type: JSON

The JSON Payload
Your request body must include the following 4 parameters:

Parameter Breakdown:
friend_name: This tells the bot which cookies to load from Supabase. It must match the friend_name column in your database exactly.

platform: Tells the router which script to run. Must match the platform column in your database (instagram, tiktok, threads, x).

media_url: A direct, publicly accessible link to the .jpg or .mp4 you want to post.

content: The text caption for your post.

🕵️‍♂️ Troubleshooting
Error: No cookies found for X on Y: Check your spelling. The friend_name and platform you sent in the request do not match what is written in Supabase.

Error: supabaseUrl is required: You forgot to add your SUPABASE_URL and SUPABASE_ANON_KEY to the Variables tab in Railway.

Crashes during TikTok upload: TikTok requires a lot of memory to process video uploads. Ensure your Railway service has at least 1GB of RAM allocated.

Timeout Errors in n8n: Browser automation is slow. Ensure your n8n HTTP Request node has its timeout setting increased to at least 120000 milliseconds (2 minutes).

⚠️ Disclaimer
This is an unofficial automation tool. Social media platforms frequently update their DOM structures (button names, popup locations) and bot-detection algorithms. Using headless browsers to automate actions violates the Terms of Service of most social networks. Use this tool responsibly and at your own risk.
