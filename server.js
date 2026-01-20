import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { parseM3U, parseM3UAll } from "./backend/m3uParser.js";
import { getLogo, matchChannel, getChannelOrder, ALLOWED_M3U_CHANNELS } from "./backend/channelMap.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' blob:; worker-src * blob: data:; connect-src *; img-src * data: blob:; frame-src *; style-src * 'unsafe-inline';"
  );
  next();
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, "./sportsflix-ui-template/frontend/index.html"));
});
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, "./sportsflix-ui-template/frontend/index.html"));
});
app.get('/home.html', (req, res) => {
  res.sendFile(path.join(__dirname, "./sportsflix-ui-template/frontend/index.html"));
});
app.get('/channel.html', (req, res) => {
  res.sendFile(path.join(__dirname, "./sportsflix-ui-template/frontend/channel.html"));
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use(express.static(path.join(__dirname, "./sportsflix-ui-template/frontend")));

const SOURCES = [
  "https://raw.githubusercontent.com/dopramo/streams/refs/heads/main/manualstreams.m3u"
];

// M3U-only channels endpoint
app.get("/api/channels", async (req, res) => {
  const map = {};

  for (const s of SOURCES) {
    try {
      const list = await parseM3U(s, true);
      list.forEach(i => {
        if (!ALLOWED_M3U_CHANNELS.includes(i.channel)) return;
        if (!map[i.channel]) map[i.channel] = { logo: null, streams: [] };
        if (i.logo) map[i.channel].logo = i.logo;
        else if (!map[i.channel].logo) map[i.channel].logo = getLogo(i.channel);
        map[i.channel].streams.push(i.url);
      });
    } catch (err) {
      console.error(`Failed to fetch ${s}:`, err.message);
    }
  }

  const sortedMap = {};
  const channelNames = Object.keys(map).sort((a, b) => {
    const orderA = getChannelOrder(a);
    const orderB = getChannelOrder(b);
    if (orderA !== orderB) return orderA - orderB;
    return a.localeCompare(b);
  });
  channelNames.forEach(name => { sortedMap[name] = map[name]; });
  res.json(sortedMap);
});

// Unified channels endpoint (CricHD + M3U combined)
app.get("/api/all-channels", async (req, res) => {
  try {
    const combined = {};
    const CRICHD_M3U = "https://raw.githubusercontent.com/abusaeeidx/CricHd-playlists-Auto-Update-permanent/main/ALL.m3u";

    // Load CricHD channels
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
      console.log(`Loaded ${Object.keys(combined).length} CricHD channels`);
    } catch (e) {
      console.error('Failed to load CricHD:', e.message);
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

    // Hidden channels
    const HIDDEN_CHANNELS = [
      "espn501", "espn 501", "espn 1", "espn1", "astro cricket", "fox cricket",
      "super football", "super premier league",
      "sky sport nz 1", "sky sport nz 2", "sky sport nz 3", "sky sport nz 4",
      "sky sport nz 5", "sky sport nz 6", "sky sport nz 7", "sky sport nz 8",
      "sky sport nz 9", "sky sport 6 nz"
    ];
    
    HIDDEN_CHANNELS.forEach(hidden => {
      Object.keys(combined).forEach(k => {
        if (k.toLowerCase().includes(hidden) || hidden.includes(k.toLowerCase())) {
          delete combined[k];
        }
      });
    });

    Object.keys(combined).forEach(k => {
      if (!combined[k].logo) combined[k].logo = getLogo(k);
    });

    // Sort channels
    const sortedMap = {};
    const channelNames = Object.keys(combined).sort((a, b) => {
      const orderA = getChannelOrder(a);
      const orderB = getChannelOrder(b);
      if (orderA !== orderB) return orderA - orderB;
      return a.localeCompare(b);
    });
    channelNames.forEach(name => { sortedMap[name] = combined[name]; });

    res.json(sortedMap);
  } catch (err) {
    console.error('Failed to build unified channel list:', err.message);
    res.status(500).json({ error: 'Failed to build unified channel list' });
  }
});

// Individual channel endpoint
app.get("/api/channel/:name", async (req, res) => {
  const channelName = decodeURIComponent(req.params.name).toLowerCase();
  const CRICHD_M3U = "https://raw.githubusercontent.com/abusaeeidx/CricHd-playlists-Auto-Update-permanent/main/ALL.m3u";
  const combined = {};

  try {
    const crichdList = await parseM3UAll(CRICHD_M3U, true);
    crichdList.forEach(item => {
      const name = item.channel.toLowerCase();
      if (!combined[name]) combined[name] = { logo: item.logo || null, streams: [], source: 'crichd' };
      if (item.logo && !combined[name].logo) combined[name].logo = item.logo;
      combined[name].streams.push(item.url);
    });
  } catch (e) {}

  for (const s of SOURCES) {
    try {
      const list = await parseM3U(s, true);
      for (const item of list) {
        if (!ALLOWED_M3U_CHANNELS.includes(item.channel)) continue;
        combined[item.channel] ??= { logo: null, streams: [], source: 'm3u' };
        if (!combined[item.channel].logo) combined[item.channel].logo = item.logo || getLogo(item.channel);
        combined[item.channel].streams.push(item.url);
      }
    } catch (err) {}
  }

  const channelData = combined[channelName];
  if (!channelData || channelData.streams.length === 0) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  if (!channelData.logo) channelData.logo = getLogo(channelName);
  res.json({ channel: channelName, logo: channelData.logo, streams: channelData.streams, source: channelData.source || 'unknown' });
});

// Logo proxy
app.get("/api/logo", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("URL required");
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer', timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*,*/*', 'Referer': new URL(url).origin }
    });
    res.setHeader('Content-Type', response.headers['content-type'] || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(response.data));
  } catch (err) {
    res.status(500).send('Failed to fetch logo');
  }
});

// CricHD channels endpoint
app.get("/api/crichd-channels", async (req, res) => {
  const CRICHD_M3U = "https://raw.githubusercontent.com/abusaeeidx/CricHd-playlists-Auto-Update-permanent/main/ALL.m3u";
  const excludePatterns = ['fox cricket 501', 'espn 1', 'astro cricket', 'super premier league', 'super football', 'sky sport nz', 'sky sports nz'];
  
  try {
    const list = await parseM3UAll(CRICHD_M3U, true);
    const map = {};
    list.forEach(item => {
      const normalized = item.channel.toLowerCase();
      if (excludePatterns.some(p => normalized.includes(p))) return;
      if (!map[item.channel]) map[item.channel] = { logo: item.logo || null, streams: [] };
      if (item.logo && !map[item.channel].logo) map[item.channel].logo = item.logo;
      map[item.channel].streams.push(item.url);
    });
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch CricHD channels' });
  }
});

// Stream check
app.post("/api/check-stream", express.json(), async (req, res) => {
  const { url } = req.body;
  if (!url) return res.json({ online: false });
  try {
    const response = await axios.get(url, { timeout: 3000, maxRedirects: 5, validateStatus: s => s < 500, headers: { 'User-Agent': 'Mozilla/5.0' }, responseType: 'stream', maxContentLength: 1024 });
    if (response.data && response.data.destroy) response.data.destroy();
    res.json({ online: response.status >= 200 && response.status < 400 });
  } catch (err) {
    res.json({ online: !!(err.response && err.response.status < 500) });
  }
});

// Proxy endpoint
app.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("URL required");

  try {
    const urlObj = new URL(url);
    const isM3U8 = url.includes('.m3u8');
    
    let headers = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Origin': 'https://profamouslife.com',
      'Referer': 'https://profamouslife.com/'
    };
    
    if (url.includes('thepapare.com')) {
      headers = { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*', 'Origin': 'https://www.thepapare.com', 'Referer': 'https://www.thepapare.com/' };
    }
    if (url.includes('ml-pull-dvc-myco.io') || url.includes('GEO_SUPER')) {
      headers = { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*', 'Origin': 'https://geosuper.tv', 'Referer': 'https://geosuper.tv/' };
    }
    
    const response = await axios.get(url, { responseType: isM3U8 ? 'text' : 'stream', timeout: 10000, headers });
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    if (isM3U8) {
      const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
      let content = response.data;
      content = content.replace(/^(?!#)(.+\.ts.*)$/gm, (match) => {
        if (match.startsWith('http')) return `/proxy?url=${encodeURIComponent(match)}`;
        return `/proxy?url=${encodeURIComponent(baseUrl + match)}`;
      });
      content = content.replace(/^(?!#)(.+\.m3u8.*)$/gm, (match) => {
        if (match.startsWith('http')) return `/proxy?url=${encodeURIComponent(match)}`;
        return `/proxy?url=${encodeURIComponent(baseUrl + match)}`;
      });
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(content);
    } else {
      const contentType = response.headers['content-type'] || 'video/MP2T';
      res.setHeader('Content-Type', contentType);
      response.data.pipe(res);
    }
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).send('Proxy failed');
  }
});

app.options('/proxy', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.status(200).end();
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
