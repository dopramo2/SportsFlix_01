
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { parseM3U, parseM3UAll } from "./m3uParser.js";
import { getLogo, matchChannel, getChannelOrder, ALLOWED_M3U_CHANNELS } from "./channelMap.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app=express();
app.use(cors());

// Set Content Security Policy to allow eval and workers (needed for HLS.js)
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' blob:; worker-src * blob: data:; connect-src *; img-src * data: blob:; frame-src *; style-src * 'unsafe-inline';"
  );
  next();
});

// Serve specific HTML files BEFORE static middleware
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, "../sportsflix-ui-template/frontend/index.html"));
});
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, "../sportsflix-ui-template/frontend/index.html"));
});
app.get('/home.html', (req, res) => {
  res.sendFile(path.join(__dirname, "../sportsflix-ui-template/frontend/index.html"));
});
app.get('/channel.html', (req, res) => {
  res.sendFile(path.join(__dirname, "../sportsflix-ui-template/frontend/channel.html"));
});

// Serve favicon (prevent 404)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Serve UI template static files (CSS, JS, images)
app.use(express.static(path.join(__dirname, "../sportsflix-ui-template/frontend")));

// M3U playlist sources from /home/dopramo/Documents/SPORTS/streamraw
const SOURCES=[
 "https://raw.githubusercontent.com/dopramo/streams/refs/heads/main/manualstreams.m3u"
];

const MANUAL_STREAM_FILE = "/home/dopramo/Documents/SPORTS/mystreamlist";
const MANUAL_STREAM_TS_FILE = "/home/dopramo/Documents/iptv-edu-player/manualstreamts.txt";

app.get("/api/channels", async (req,res)=>{
  const map={};

  // manual streams from manualstreamts.txt (Name, URL, Logo format) - HIGHEST PRIORITY
  // Only use logos from this file for channels that have logos (Papare and Geo Super)
  const manualLogoChannels = new Set(); // Track which channels have logos from manual file
  if (fs.existsSync(MANUAL_STREAM_TS_FILE)) {
    const content = fs.readFileSync(MANUAL_STREAM_TS_FILE,"utf8");
    const lines = content.split("\n").map(l => l.trim());
    
    let i = 0;
    while (i < lines.length) {
      const channelName = lines[i++];
      if (!channelName || channelName.startsWith("#")) continue;
      
      const streamUrl = i < lines.length ? lines[i++] : "";
      if (!streamUrl || !streamUrl.startsWith("http")) {
        i++; // Skip logo line if URL is invalid
        continue;
      }
      
      const logoUrl = i < lines.length ? lines[i++] : "";
      
      // Skip blank line
      if (i < lines.length && !lines[i]) i++;
      
      // Match channel name (only allowed M3U channels)
      const matched = matchChannel(channelName);
      if (!matched || !ALLOWED_M3U_CHANNELS.includes(matched)) {
        continue;
      }
      
      // Initialize channel if not exists
      if (!map[matched]) {
        map[matched] = { logo: null, streams: [] };
      }
      
      // ONLY use logo from manual file if it's provided (Papare and Geo Super have logos)
      if (logoUrl && logoUrl.startsWith("http")) {
        map[matched].logo = logoUrl;
        manualLogoChannels.add(matched);
      }
      
      // Add stream URL at the beginning (highest priority)
      map[matched].streams.unshift(streamUrl);
      console.log(`✓ Added manual stream from manualstreamts.txt: ${matched} <- ${channelName} (logo: ${logoUrl ? 'yes' : 'no'})`);
    }
  }

  // manual streams from mystreamlist (URL  Name format)
  if (fs.existsSync(MANUAL_STREAM_FILE)) {
    const content = fs.readFileSync(MANUAL_STREAM_FILE,"utf8");
    content.split("\n").forEach(l=>{
      l = l.trim();
      if (!l || l.startsWith("#")) return;
      
      // Split by 1 or more spaces to separate URL from name
      const match = l.match(/^(https?:\/\/\S+)\s+(.+)$/);
      if (!match) return;
      
      const url = match[1];
      const name = match[2].trim();
      
      if(!url.startsWith("http")) return;
      
      // Normalize and match the channel name (only allowed M3U channels)
      const matched = matchChannel(name);
      if (!matched || !ALLOWED_M3U_CHANNELS.includes(matched)) {
        console.log(`Manual stream skipped (not allowed): ${name}`);
        return;
      }
      
      // Don't override if already set from manualstreamts.txt (those have priority)
      if (map[matched]) {
        // Only add additional streams
        map[matched].streams.push(url);
        console.log(`✓ Added additional manual stream: ${matched} <- ${name}`);
        return;
      }
      
      map[matched]??={logo:getLogo(matched),streams:[]};
      map[matched].streams.push(url);
      console.log(`✓ Added manual stream: ${matched} <- ${name}`);
    });
  }

  // github streams - only add allowed M3U channels (SECOND PRIORITY after manual URLs)
  for (const s of SOURCES) {
    try {
      const list=await parseM3U(s, true);
      list.forEach(i=>{
        // Only process allowed M3U channels
        if (!ALLOWED_M3U_CHANNELS.includes(i.channel)) {
          return;
        }
        
        // Initialize if not exists
        if (!map[i.channel]) {
          map[i.channel] = { logo: null, streams: [] };
        }
        
        // Use logo from M3U/raw file ONLY if channel doesn't have manual logo
        // (Only Papare and Geo Super have manual logos)
        if (!manualLogoChannels.has(i.channel)) {
          if (i.logo) {
            map[i.channel].logo = i.logo;
          } else if (!map[i.channel].logo) {
            map[i.channel].logo = getLogo(i.channel);
          }
        }
        
        // Add stream URL (manual URLs are already at the beginning)
        map[i.channel].streams.push(i.url);
      });
    } catch(err) {
      console.error(`Failed to fetch ${s}:`, err.message);
    }
  }

  // Sort channels by specified order
  const sortedMap = {};
  const channelNames = Object.keys(map).sort((a, b) => {
    const orderA = getChannelOrder(a);
    const orderB = getChannelOrder(b);
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    // If same order (or both not in order list), sort alphabetically
    return a.localeCompare(b);
  });
  
  channelNames.forEach(channelName => {
    sortedMap[channelName] = map[channelName];
  });

  res.json(sortedMap);
});

// Unified channels endpoint (CricHD + M3U combined)
app.get("/api/all-channels", async (req, res) => {
  try {
    const combined = {};

    // --- 1) Load CricHD channels (unfiltered) ---
    const CRICHD_M3U = "https://raw.githubusercontent.com/abusaeeidx/CricHd-playlists-Auto-Update-permanent/main/ALL.m3u";
    try {
      const crichdList = await parseM3UAll(CRICHD_M3U, true);
      crichdList.forEach(item => {
        const channelName = item.channel;
        if (!combined[channelName]) {
          combined[channelName] = { logo: item.logo || null, streams: [], source: 'crichd' };
        }
        if (item.logo && !combined[channelName].logo) combined[channelName].logo = item.logo;
        combined[channelName].streams.push(item.url);
      });
      console.log(`✓ Loaded ${Object.keys(combined).length} CricHD channels into unified map`);
    } catch (e) {
      console.error('Failed to load CricHD for unified map:', e.message);
    }

    // Helper: quick stream online check (reuse /api/check-stream logic)
    async function isStreamOnline(url) {
      if (!url) return false;
      try {
        const response = await axios.get(url, { 
          timeout: 3000,
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 500,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': '*/*',
            'Connection': 'keep-alive'
          },
          responseType: 'stream',
          maxContentLength: 1024
        });
        if (response.data && response.data.destroy) response.data.destroy();
        return response.status >= 200 && response.status < 400;
      } catch (err) {
        return !!(err.response && err.response.status < 500);
      }
    }

    // --- 2) Load manual M3U streams (if any) ---
    if (fs.existsSync(MANUAL_STREAM_TS_FILE)) {
      const content = fs.readFileSync(MANUAL_STREAM_TS_FILE,"utf8");
      const lines = content.split("\n").map(l => l.trim());
      let i = 0;
      while (i < lines.length) {
        const channelName = lines[i++];
        if (!channelName || channelName.startsWith("#")) continue;
        const streamUrl = i < lines.length ? lines[i++] : "";
        if (!streamUrl || !streamUrl.startsWith("http")) {
          i++; // skip logo line if URL invalid
          continue;
        }
        const logoUrl = i < lines.length ? lines[i++] : "";
        if (i < lines.length && !lines[i]) i++;

        const matched = matchChannel(channelName);
        if (!matched || !ALLOWED_M3U_CHANNELS.includes(matched)) continue;

        // Ensure channel exists in combined map
        combined[matched] ??= { logo: null, streams: [], source: 'm3u' };
        // Use manual logo if provided
        if (logoUrl && logoUrl.startsWith("http")) combined[matched].logo = logoUrl;
        // Add stream (manual streams prioritized)
        // Check quickly if stream online; if offline skip silently
        try {
          const ok = await isStreamOnline(streamUrl);
          if (ok) {
            combined[matched].streams.unshift(streamUrl);
            console.log(`✓ Added manual M3U stream for ${matched}`);
          } else {
            console.log(`- Skipped offline manual stream for ${matched}`);
          }
        } catch (e) {
          // skip silently
        }
      }
    }

    if (fs.existsSync(MANUAL_STREAM_FILE)) {
      const content = fs.readFileSync(MANUAL_STREAM_FILE,"utf8");
      content.split("\n").forEach(l=>{
        l = l.trim();
        if (!l || l.startsWith("#")) return;
        const match = l.match(/^(https?:\/\/\S+)\s+(.+)$/);
        if (!match) return;
        const url = match[1];
        const name = match[2].trim();
        if(!url.startsWith("http")) return;
        const matched = matchChannel(name);
        if (!matched || !ALLOWED_M3U_CHANNELS.includes(matched)) {
          console.log(`Manual stream skipped (not allowed): ${name}`);
          return;
        }
        combined[matched] ??= { logo: getLogo(matched), streams: [], source: 'm3u' };
        // Check online before adding
        (async () => {
          try {
            const ok = await isStreamOnline(url);
            if (ok) {
              combined[matched].streams.push(url);
              console.log(`✓ Added manual stream: ${matched} <- ${name}`);
            } else {
              console.log(`- Skipped offline manual stream: ${matched} <- ${name}`);
            }
          } catch (e) {}
        })();
      });
    }

    // --- 3) Load M3U sources from configured SOURCES (GitHub raw, etc.) ---
    for (const s of SOURCES) {
      try {
        const list = await parseM3U(s, true);
        // For each candidate, only accept allowed channels - add streams directly without online check
        for (const item of list) {
          if (!ALLOWED_M3U_CHANNELS.includes(item.channel)) continue;
          combined[item.channel] ??= { logo: null, streams: [], source: 'm3u' };
          // If channel already has a manual logo, keep it; else use item.logo or fallback
          if (!combined[item.channel].logo) {
            combined[item.channel].logo = item.logo || getLogo(item.channel);
          }
          // Add stream directly without online check (some streams return 403 on HEAD but work in player)
          combined[item.channel].streams.push(item.url);
          console.log(`✓ Added M3U stream for ${item.channel}: ${item.url}`);
        }
        console.log(`✓ Processed M3U source: ${s}`);
      } catch (err) {
        console.error(`Failed to fetch ${s}:`, err.message);
      }
    }

    // --- 4) Finalize: merge ordering and set source flags ---
    // Hidden channels - these will not appear in the channel list
    const HIDDEN_CHANNELS = [
      "espn501", "espn 501", "espn 1", "espn1",
      "astro cricket",
      "fox cricket",
      "super football", "super premier league",
      // Sky Sports NZ channels
      "sky sport nz 1", "sky sport nz 2", "sky sport nz 3", "sky sport nz 4",
      "sky sport nz 5", "sky sport nz 6", "sky sport nz 7", "sky sport nz 8",
      "sky sport nz 9", "sky sport 6 nz",
      "sky sports nz 1", "sky sports nz 2", "sky sports nz 3", "sky sports nz 4",
      "sky sports nz 5", "sky sports nz 6", "sky sports nz 7", "sky sports nz 8",
      "sky sports nz 9"
    ];
    
    // Remove hidden channels
    HIDDEN_CHANNELS.forEach(hidden => {
      Object.keys(combined).forEach(k => {
        if (k.toLowerCase().includes(hidden) || hidden.includes(k.toLowerCase())) {
          delete combined[k];
        }
      });
    });
    
    // If a channel has both CricHD and M3U streams, prefer 'crichd' (to keep CricHD behavior intact)
    Object.keys(combined).forEach(k => {
      if (combined[k].streams == null) combined[k].streams = [];
      // If logo missing, fallback
      if (!combined[k].logo) combined[k].logo = getLogo(k);
      // Ensure source is 'crichd' if any stream was from CricHD
      if (combined[k].source !== 'crichd') {
        // detect if any existing stream equals one from CricHD map by checking previous CRICHD load
        // (we already set source='crichd' when adding crichd entries above)
        // keep as-is (m3u) otherwise
      }
    });

    // Sort channels by specified order (getChannelOrder) and alphabetically
    const sortedMap = {};
    const channelNames = Object.keys(combined).sort((a, b) => {
      const orderA = getChannelOrder(a);
      const orderB = getChannelOrder(b);
      if (orderA !== orderB) return orderA - orderB;
      return a.localeCompare(b);
    });
    channelNames.forEach(name => {
      sortedMap[name] = combined[name];
    });

    res.json(sortedMap);
  } catch (err) {
    console.error('Failed to build unified channel list:', err.message);
    res.status(500).json({ error: 'Failed to build unified channel list' });
  }
});

// Individual channel endpoint for channel player page
app.get("/api/channel/:name", async (req, res) => {
  const channelName = decodeURIComponent(req.params.name).toLowerCase();
  
  try {
    // Try to find the channel from the unified endpoint data
    const CRICHD_M3U = "https://raw.githubusercontent.com/abusaeeidx/CricHd-playlists-Auto-Update-permanent/main/ALL.m3u";
    const combined = {};
    
    // Load CricHD channels
    try {
      const crichdList = await parseM3UAll(CRICHD_M3U, true);
      crichdList.forEach(item => {
        const name = item.channel.toLowerCase();
        if (!combined[name]) {
          combined[name] = { logo: item.logo || null, streams: [], source: 'crichd' };
        }
        if (item.logo && !combined[name].logo) combined[name].logo = item.logo;
        combined[name].streams.push(item.url);
      });
    } catch (e) {
      console.error('Failed to load CricHD for channel lookup:', e.message);
    }
    
    // Load M3U sources
    for (const s of SOURCES) {
      try {
        const list = await parseM3U(s, true);
        for (const item of list) {
          if (!ALLOWED_M3U_CHANNELS.includes(item.channel)) continue;
          combined[item.channel] ??= { logo: null, streams: [], source: 'm3u' };
          if (!combined[item.channel].logo) {
            combined[item.channel].logo = item.logo || getLogo(item.channel);
          }
          combined[item.channel].streams.push(item.url);
        }
      } catch (err) {
        console.error(`Failed to fetch ${s}:`, err.message);
      }
    }
    
    // Find the channel
    const channelData = combined[channelName];
    if (!channelData || channelData.streams.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    
    // Set logo fallback
    if (!channelData.logo) {
      channelData.logo = getLogo(channelName);
    }
    
    res.json({
      channel: channelName,
      logo: channelData.logo,
      streams: channelData.streams,
      source: channelData.source || 'unknown'
    });
  } catch (err) {
    console.error('Failed to get channel:', err.message);
    res.status(500).json({ error: 'Failed to get channel' });
  }
});

// Logo proxy endpoint
app.get("/api/logo", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("URL required");
  
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*,*/*',
        'Referer': new URL(url).origin
      }
    });
    
    const contentType = response.headers['content-type'] || 'image/png';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error('Logo proxy error:', err.message);
    res.status(500).send('Failed to fetch logo');
  }
});

// CricHD channels endpoint - show ALL channels without filtering, but exclude specific channels
app.get("/api/crichd-channels", async (req, res) => {
  const CRICHD_M3U = "https://raw.githubusercontent.com/abusaeeidx/CricHd-playlists-Auto-Update-permanent/main/ALL.m3u";
  
  // Channels to exclude from CricHD
  const excludePatterns = [
    'fox cricket 501 hd',
    'fox cricket 501',
    'espn 1',
    'astro cricket',
    'super premier league',
    'super football',
    'sky sport nz',
    'sky sports nz',
    'sky sport 6 nz',
    'sky sport 1 nz',
    'sky sport 2 nz',
    'sky sport 3 nz',
    'sky sport 4 nz',
    'sky sport 5 nz',
    'sky sport 7 nz',
    'sky sport 8 nz',
    'sky sport 9 nz',
    'sky sport 10 nz'
  ];
  
  function shouldExcludeChannel(channelName) {
    const normalized = channelName.toLowerCase();
    return excludePatterns.some(pattern => normalized.includes(pattern));
  }
  
  try {
    // Use parseM3UAll to get ALL channels without filtering
    const list = await parseM3UAll(CRICHD_M3U, true);
    const map = {};
    
    list.forEach(item => {
      const channelName = item.channel;
      
      // Skip excluded channels
      if (shouldExcludeChannel(channelName)) {
        return;
      }
      
      // Use original channel name from M3U (normalized to lowercase)
      if (!map[channelName]) {
        map[channelName] = { 
          logo: item.logo || null, 
          streams: [] 
        };
      }
      
      // Prioritize extracted logo from M3U
      if (item.logo && !map[channelName].logo) {
        map[channelName].logo = item.logo;
      }
      
      map[channelName].streams.push(item.url);
    });
    
    console.log(`✓ Loaded ${Object.keys(map).length} CricHD channels (excluded ${excludePatterns.length} channel types)`);
    res.json(map);
  } catch (err) {
    console.error('Failed to fetch CricHD channels:', err.message);
    res.status(500).json({ error: 'Failed to fetch CricHD channels' });
  }
});

// Stream status check endpoint
app.post("/api/check-stream", express.json(), async (req, res) => {
  const { url } = req.body;
  if (!url) return res.json({ online: false });

  try {
    // Try GET request with short timeout instead of HEAD
    const response = await axios.get(url, { 
      timeout: 3000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 500,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Connection': 'keep-alive'
      },
      responseType: 'stream',
      maxContentLength: 1024 // Only fetch first 1KB
    });
    
    // Destroy the stream immediately
    if (response.data && response.data.destroy) {
      response.data.destroy();
    }
    
    const isOnline = response.status >= 200 && response.status < 400;
    res.json({ online: isOnline });
  } catch (err) {
    // Check if it's a timeout or network error
    const isOnline = err.response && err.response.status < 500;
    res.json({ online: isOnline });
  }
});

// CORS Proxy endpoint for streams
app.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("URL required");

  try {
    const urlObj = new URL(url);
    const isM3U8 = url.includes('.m3u8');
    
    console.log(`\n🔗 Proxying: ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}`);
    
    // Custom headers for specific streams
    let headers = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Origin': 'https://profamouslife.com',
      'Referer': 'https://profamouslife.com/',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'cross-site'
    };
    
    // The Papare stream - use their own domain as referer
    if (url.includes('thepapare.com')) {
      headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Origin': 'https://www.thepapare.com',
        'Referer': 'https://www.thepapare.com/'
      };
    }
    
    // Geo Super stream - try different headers
    if (url.includes('ml-pull-dvc-myco.io') || url.includes('GEO_SUPER')) {
      headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Origin': 'https://geosuper.tv',
        'Referer': 'https://geosuper.tv/'
      };
    }
    
    const response = await axios.get(url, {
      responseType: isM3U8 ? 'text' : 'stream',
      timeout: 10000,
      headers
    });
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    // If M3U8, rewrite URLs to go through proxy
    if (isM3U8) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      
      let content = response.data;
      let urlsRewritten = 0;
      
      // Rewrite relative URLs in M3U8 to absolute URLs through proxy
      content = content.split('\n').map(line => {
        const originalLine = line;
        line = line.trim();
        
        // Skip comments and empty lines
        if (line.startsWith('#') || !line) return originalLine;
        
        // Check if line contains a URL (not starting with http means it's relative)
        if (!line.startsWith('http://') && !line.startsWith('https://') && !line.startsWith('/proxy')) {
          // Use URL constructor to properly resolve relative paths
          let absoluteUrl;
          try {
            absoluteUrl = new URL(line, url).href;
            urlsRewritten++;
            if (urlsRewritten <= 3) {
              console.log(`  ✓ Resolved: ${line} -> ${absoluteUrl.substring(0, 80)}...`);
            }
          } catch (e) {
            console.error(`  ✗ Failed to resolve URL: ${line}`, e.message);
            return originalLine; // Return original if we can't resolve
          }
          return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
        }
        // If it's already absolute, proxy it
        else if (line.startsWith('http')) {
          urlsRewritten++;
          return `/proxy?url=${encodeURIComponent(line)}`;
        }
        
        return originalLine;
      }).join('\n');
      
      console.log(`  📝 Rewrote ${urlsRewritten} URLs in M3U8`);
      if (urlsRewritten > 0 && urlsRewritten <= 5) {
        console.log(`  📄 First few lines of rewritten M3U8:\n${content.split('\n').slice(0, 15).join('\n')}\n`);
      }
      res.send(content);
    } else {
      // For non-M3U8 files (TS segments), stream directly
      if (response.headers['content-type']) {
        res.setHeader('Content-Type', response.headers['content-type']);
      } else if (url.includes('.ts')) {
        res.setHeader('Content-Type', 'video/mp2t');
      }
      
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }
      if (response.headers['accept-ranges']) {
        res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
      }
      
      response.data.pipe(res);
    }
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).send('Proxy error');
  }
});

app.listen(5000,()=>console.log("Backend on http://localhost:5000"));
