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
