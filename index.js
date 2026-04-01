require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { execSync } = require('child_process');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ─── Serve uploaded files publicly ──────────────────────────────────────────
app.use('/files', express.static(path.join(__dirname, 'tmp')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'tmp')),
  filename: (req, file, cb) => cb(null, `img_${Date.now()}.jpg`)
});
const upload = multer({ storage });

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  
  // ✅ RAILWAY FIX 1: Use dynamic host instead of hardcoded Hostinger IP
  const url = `${req.protocol}://${req.get('host')}/files/${req.file.filename}`;
  
  console.log(`[+] Image uploaded: ${url}`);
  res.json({ url });
});

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    protocol.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function cleanCookies(cookies) {
  return cookies.map(cookie => {
    const cleaned = { ...cookie };
    if (cleaned.sameSite && !['Strict', 'Lax', 'None'].includes(cleaned.sameSite)) {
      if (cleaned.sameSite === 'no_restriction') cleaned.sameSite = 'None';
      else delete cleaned.sameSite;
    }
    delete cleaned.hostOnly;
    delete cleaned.session;
    delete cleaned.storeId;
    delete cleaned.id;
    return cleaned;
  });
}

// ─── Main Publish Route ──────────────────────────────────────────────────────
app.post('/publish', async (req, res) => {
  const { friend_name, platform, media_url, content } = req.body;

  if (!friend_name || !platform || !content) {
    return res.status(400).json({ error: 'Missing friend_name, platform, or content' });
  }

  console.log(`\n[+] New request → ${friend_name} | ${platform}`);
  let browser;
  let tempFilePath = null;

  try {
    const { data, error } = await supabase
      .from('social_cookies')
      .select('cookie_json')
      .eq('friend_name', friend_name)
      .eq('platform', platform)
      .single();

    if (error || !data) {
      console.error('[-] Cookie fetch failed:', error);
      return res.status(404).json({ error: `No cookies found for ${friend_name} on ${platform}` });
    }

    const cookies = cleanCookies(data.cookie_json);
    console.log(`[+] Cookies loaded for ${friend_name}`);

    if (media_url) {
      const ext = media_url.includes('.mp4') ? '.mp4' : '.jpg';
      tempFilePath = path.join(__dirname, 'tmp', `${friend_name}_${Date.now()}${ext}`);
      console.log(`[+] Downloading media...`);
      await downloadFile(media_url, tempFilePath);
      console.log(`[+] Media saved to ${tempFilePath}`);

      // 🎥 CONVERT TO 15-SEC VIDEO WITH RANDOM MUSIC FOR TIKTOK ONLY
      if (platform === 'tiktok' && ext === '.jpg') {
        console.log(`[+] Converting JPG to a 15-second MP4 video for TikTok...`);
        const videoPath = tempFilePath.replace('.jpg', '.mp4');
        const musicDir = path.join(__dirname, 'music');
        let audioCommand = '';
        let audioMapping = '';

        try {
          if (fs.existsSync(musicDir)) {
            const tracks = fs.readdirSync(musicDir).filter(f => f.endsWith('.mp3'));
            if (tracks.length > 0) {
              const randomTrack = path.join(musicDir, tracks[Math.floor(Math.random() * tracks.length)]);
              console.log(`[+] Selected background track: ${path.basename(randomTrack)}`);
              audioCommand = `-i "${randomTrack}"`;
              audioMapping = `-c:a aac -b:a 192k -shortest`;
            }
          }

          const ffmpegCmd = `ffmpeg -loop 1 -i "${tempFilePath}" ${audioCommand} -c:v libx264 ${audioMapping} -t 15 -pix_fmt yuv420p "${videoPath}"`;
          
          execSync(ffmpegCmd);
          fs.unlinkSync(tempFilePath); 
          tempFilePath = videoPath;    
          console.log(`[+] Video conversion successful: ${tempFilePath}`);
        } catch (ffmpegErr) {
          console.error(ffmpegErr);
          throw new Error('Video conversion failed. Is ffmpeg installed on the server?');
        }
      }
    }

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // 🚨 PLAYWRIGHT CLIPBOARD PERMISSIONS
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'] 
    });

    await context.addCookies(cookies);
    const page = await context.newPage();

    // 🔥 PLATFORM ROUTER 🔥
    if (platform === 'instagram') {
      await postToInstagram(page, tempFilePath, content);
    } else if (platform === 'tiktok') {
      await postToTikTok(page, tempFilePath, content);
    } else if (platform === 'threads') {
      await postToThreads(page, tempFilePath, content);
    } else if (platform === 'x') {
      await postToX(page, tempFilePath, content);
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    await browser.close();

    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
      console.log(`[+] Temp file deleted`);
    }

    console.log(`[✅] Successfully posted to ${platform} for ${friend_name}`);
    res.status(200).json({ success: true, message: `Posted to ${platform} for ${friend_name}` });

  } catch (err) {
    console.error('[-] Error:', err.message);
    if (browser) await browser.close();
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    res.status(500).json({ error: 'Automation failed', details: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// INSTAGRAM (100% UNTOUCHED)
// ════════════════════════════════════════════════════════════════════════════
async function postToInstagram(page, filePath, caption) {
  console.log(`[+] Opening Instagram...`);
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  if (page.url().includes('login')) throw new Error('Instagram cookies expired. Please re-export.');

  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const notNow = buttons.find(b => b.textContent && b.textContent.includes('Not Now'));
    if (notNow) notNow.click();
  }).catch(() => {});
  await page.waitForTimeout(2000);

  console.log(`[+] Clicking Create Post button...`);
  try {
    await page.locator('svg[aria-label="New post"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(2000); 
    const postOption = page.locator('span').filter({ hasText: /^Post$/i }).first();
    if (await postOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await postOption.click();
    } else {
        await page.locator('text="Post"').first().click({ timeout: 2000 }).catch(() => {});
    }
  } catch (e) {
    await page.locator('a[href="/create/style/"]').first().click({ timeout: 5000 }).catch(() => {});
  }

  await page.waitForTimeout(4000);

  console.log(`[+] Triggering file upload...`);
  try {
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      page.locator('button').filter({ hasText: /Select from computer/i }).click().catch(async () => {
         await page.mouse.click(page.viewportSize().width / 2, page.viewportSize().height / 2);
      })
    ]);
    await fileChooser.setFiles(filePath);
  } catch (e) {
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 5000 });
    await fileInput.setInputFiles(filePath);
  }

  await page.waitForTimeout(4000);

  for (let i = 0; i < 3; i++) {
    const nextBtn = page.locator('button').filter({ hasText: /^Next$/i }).last();
    if (await nextBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(2500);
    } else {
       const nextDiv = page.locator('div[role="button"]').filter({ hasText: /^Next$/i }).last();
       if (await nextDiv.isVisible({ timeout: 1000 }).catch(()=>false)) {
           await nextDiv.click();
           await page.waitForTimeout(2500);
       }
    }
  }

  const captionBox = page.locator('div[aria-label="Write a caption..."]').first();
  await captionBox.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (await captionBox.isVisible()) {
      await captionBox.click();
      await captionBox.fill(caption);
  } else {
      await page.keyboard.type(caption, { delay: 50 });
  }
  await page.waitForTimeout(1000);

  const shareBtn = page.locator('button').filter({ hasText: /^Share$/i }).last();
  if (await shareBtn.isVisible({ timeout: 5000 }).catch(()=>false)) {
     await shareBtn.click({ force: true });
  } else {
     const shareDiv = page.locator('div[role="button"]').filter({ hasText: /^Share$/i }).last();
     if(await shareDiv.isVisible({ timeout: 1000 }).catch(()=>false)){
         await shareDiv.click({ force: true });
     }
  }

  await page.waitForTimeout(25000); // Give Instagram 25 seconds to finish uploading
  console.log(`[✅] Instagram post shared!`);
}

// ════════════════════════════════════════════════════════════════════════════
// TIKTOK (100% UNTOUCHED)
// ════════════════════════════════════════════════════════════════════════════
async function postToTikTok(page, filePath, caption) {
  console.log(`[+] Opening TikTok upload page...`);
  await page.goto('https://www.tiktok.com/creator-center/upload', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  if (page.url().includes('login')) throw new Error('TikTok cookies expired.');

  await page.evaluate(() => {
    document.querySelectorAll('tiktok-cookie-banner').forEach(b => b.remove());
  }).catch(() => {});

  await page.evaluate(() => {
    document.querySelectorAll('input[type="file"]').forEach(el => {
      el.style.display = 'block';
      el.style.visibility = 'visible';
      el.style.opacity = '1';
    });
  });

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(filePath);
  await page.waitForTimeout(10000); 

  const buttonTextsToClick = ['Got it', 'Cancel', 'Not now', 'Turn on'];
  for (const text of buttonTextsToClick) {
      try {
          const btn = page.locator('button').filter({ hasText: new RegExp(`^${text}$`, 'i') }).first();
          if (await btn.isVisible({ timeout: 2000 })) {
              await btn.click();
              await page.waitForTimeout(2000);
          }
      } catch (e) {}
  }

  try {
      const captionBox = page.locator('.public-DraftEditor-content').first();
      await captionBox.waitFor({ state: 'visible', timeout: 10000 });
      await captionBox.click({ force: true });
      await page.waitForTimeout(1000);
      
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      
      await page.evaluate((text) => {
          const dataTransfer = new DataTransfer();
          dataTransfer.setData('text/plain', text);
          const event = new ClipboardEvent('paste', {
              clipboardData: dataTransfer,
              bubbles: true,
              cancelable: true
          });
          document.querySelector('.public-DraftEditor-content').dispatchEvent(event);
      }, caption);
      
      await page.waitForTimeout(2000);
      await page.keyboard.type(' ', { delay: 100 }); 

  } catch (e) {
      await page.mouse.click(800, 350); 
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(caption, { delay: 50 });
  }

  await page.mouse.click(10, 10);
  await page.waitForTimeout(30000); 

  for(let i=0; i<4; i++) {
    await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const postBtn = btns.find(b => b.textContent && b.textContent.trim() === 'Post');
        if (postBtn && !postBtn.disabled) postBtn.click();
    }).catch(() => {});

    await page.locator('button[data-e2e="post_video_button"]').click({ force: true }).catch(() => {});
    await page.locator('button:has-text("Post")').last().click({ force: true }).catch(() => {});
    await page.waitForTimeout(3000);
  }
  
  await page.waitForTimeout(45000); 
  console.log(`[✅] TikTok post process complete!`);
}

// ════════════════════════════════════════════════════════════════════════════
// THREADS (100% UNTOUCHED)
// ════════════════════════════════════════════════════════════════════════════
async function postToThreads(page, filePath, caption) {
  await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  if (page.url().includes('login')) throw new Error('Threads cookies expired.');

  try {
      const composeSelectors = [
          'svg[aria-label="Create"]',
          'svg[aria-label="Write"]',
          'div:has-text("Start a thread...")'
      ];
      for (const sel of composeSelectors) {
          const el = page.locator(sel).last(); 
          if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
              await el.click({ force: true });
              break;
          }
      }
  } catch (e) {}

  await page.waitForTimeout(4000);

  try {
      await page.evaluate(() => {
          document.querySelectorAll('input[type="file"]').forEach(el => {
              el.style.display = 'block';
              el.style.visibility = 'visible';
              el.style.opacity = '1';
          });
      });
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(filePath);
  } catch (e) {}

  await page.waitForTimeout(6000);

  let threadsCaption = caption.length > 490 ? caption.substring(0, 490) + '...' : caption;

  try {
      const captionBox = page.locator('div[contenteditable="true"]').first();
      await captionBox.waitFor({ state: 'visible', timeout: 5000 });
      await captionBox.click({ force: true });
      await page.evaluate((text) => {
          const dataTransfer = new DataTransfer();
          dataTransfer.setData('text/plain', text);
          const event = new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true });
          document.activeElement.dispatchEvent(event);
      }, threadsCaption);
  } catch (e) {
      await page.keyboard.type(threadsCaption, { delay: 50 });
  }

  await page.waitForTimeout(2000);

  for (let i = 0; i < 4; i++) {
      await page.evaluate(() => {
          const allElements = Array.from(document.querySelectorAll('*'));
          const postTexts = allElements.filter(el => el.childNodes.length === 1 && el.textContent.trim() === 'Post');
          for (const el of postTexts) {
              const btn = el.closest('div[role="button"], button') || el;
              if (btn.getAttribute('aria-disabled') !== 'true' && !btn.disabled) btn.click();
          }
      });
      await page.waitForTimeout(3000);
  }
  await page.waitForTimeout(15000);
}

// ════════════════════════════════════════════════════════════════════════════
// X (TWITTER) (100% UNTOUCHED)
// ════════════════════════════════════════════════════════════════════════════
async function postToX(page, filePath, caption) {
  await page.goto('https://x.com/compose/tweet', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  if (page.url().includes('login')) throw new Error('X cookies expired.');

  try {
      await page.evaluate(() => {
          document.querySelectorAll('input[type="file"]').forEach(el => {
              el.style.display = 'block';
              el.style.visibility = 'visible';
              el.style.opacity = '1';
          });
      });
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(filePath);
  } catch (e) {}

  await page.waitForTimeout(4000);

  let xCaption = caption.length > 270 ? caption.substring(0, 270) + '...' : caption;

  try {
      const captionBox = page.locator('div[data-testid="tweetTextarea_0"], div[role="textbox"]').first();
      await captionBox.waitFor({ state: 'visible', timeout: 5000 });
      await captionBox.click({ force: true });
      await page.evaluate((text) => {
          const dataTransfer = new DataTransfer();
          dataTransfer.setData('text/plain', text);
          const event = new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true });
          document.activeElement.dispatchEvent(event);
      }, xCaption);
  } catch (e) {
      await page.keyboard.type(xCaption, { delay: 50 });
  }

  await page.waitForTimeout(2000);

  for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Control+Enter');
      await page.evaluate(() => {
          const dialog = document.querySelector('div[role="dialog"]') || document;
          const btns = Array.from(dialog.querySelectorAll('[data-testid="tweetButton"]'));
          for (const btn of btns) {
              if (btn.getAttribute('aria-disabled') !== 'true' && !btn.disabled) btn.click();
          }
      }).catch(()=>{});
      await page.waitForTimeout(3000);
  }
  await page.waitForTimeout(15000);
}

// ✅ RAILWAY FIX 2: Listen on 0.0.0.0 so Railway can route traffic to it
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Stealth API running on port ${PORT}`);
  console.log(`📡 Ready for Railway requests`);
});
