// Get channel name from URL
const urlParams = new URLSearchParams(window.location.search);
const channelName = urlParams.get('channel');

if (!channelName) {
  window.location.href = 'home.html';
}

let channelData = null;
let currentStreamIndex = 0;
// Track per-stream attempt counts to avoid infinite retry loops
const streamAttemptCounts = {};
const MAX_ATTEMPTS_PER_STREAM = 2; // direct + proxy
let playbackInProgress = false;

// Streams that MUST be loaded directly (no proxy) - CloudFront protected
const DIRECT_ONLY_DOMAINS = [
  'thepapare.com',
  'livecdn3.thepapare.com',
  'myco.io',
  'ml-pull-dvc-myco.io'
];

function shouldLoadDirect(url) {
  try {
    const urlObj = new URL(url);
    return DIRECT_ONLY_DOMAINS.some(domain => urlObj.hostname.includes(domain));
  } catch(e) {
    return false;
  }
}

// Load channel data
async function loadChannel() {
  try {
    const response = await fetch(`/api/channel/${encodeURIComponent(channelName)}`);
    if (!response.ok) {
      throw new Error('Channel not found');
    }
    channelData = await response.json();
    
    // Update title
    document.getElementById('channel-title').textContent = channelData.channel.toUpperCase();
    
    // Set logo
    if (channelData.logo) {
      const logoImg = document.getElementById('channel-logo');
      logoImg.src = channelData.logo;
      logoImg.referrerPolicy = "no-referrer";
      logoImg.onerror = () => {
        if (!logoImg.dataset.proxyTried && channelData.logo && !channelData.logo.startsWith("/api/logo")) {
          logoImg.dataset.proxyTried = "1";
          logoImg.src = `/api/logo?url=${encodeURIComponent(channelData.logo)}`;
          return;
        }
      };
      document.getElementById('logo-overlay').style.display = 'flex';
    }
    
    // Setup player
    setupPlayer();
  } catch (err) {
    console.error('Failed to load channel:', err);
    document.getElementById('channel-title').textContent = 'Channel Not Found';
    document.querySelector('.player-wrapper').innerHTML = 
      '<div style="color: #fff; text-align: center; padding: 40px;">Channel not found. <a href="home.html" style="color: #00d4ff;">Go back</a></div>';
  }
}

function setupPlayer() {
  const video = document.getElementById('player');
  const playOverlay = document.getElementById('play-button-overlay');
  const logoOverlay = document.getElementById('logo-overlay');
  let lastUserPauseAt = 0;
  let userPaused = false;
  
  // Show play button overlay initially
  playOverlay.style.display = 'flex';
  
  // Play button click handler
  playOverlay.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (Date.now() - lastUserPauseAt < 250) {
      return;
    }
    userPaused = false;
    if (video.paused || !video.src) {
      startPlayback();
    } else {
      video.pause();
    }
  });
  
  // Video click to pause/play (only when overlay is hidden)
  video.addEventListener('click', (e) => {
    if (playOverlay.style.display === 'none') {
      e.stopPropagation();
      e.preventDefault();
      if (video.paused) {
        userPaused = false;
        video.play();
      } else {
        lastUserPauseAt = Date.now();
        userPaused = true;
        video.pause();
      }
    }
  });
  
  const liveBadge = document.getElementById('live-badge');
  
  // Hide overlay when video starts playing
  video.addEventListener('play', () => {
    if (userPaused) {
      video.pause();
      return;
    }
    playOverlay.style.display = 'none';
    logoOverlay.style.display = 'none';
    liveBadge.style.display = 'inline-block';
  });
  
  // Show overlay when video pauses
  video.addEventListener('pause', () => {
    if (video.readyState >= 2) { // Only show if video is loaded
      // Delay overlay to avoid click-through replays on the same click
      setTimeout(() => {
        playOverlay.style.display = 'flex';
        liveBadge.style.display = 'none';
      }, 100);
    }
  });
}

function startPlayback() {
  if (!channelData || channelData.streams.length === 0) {
    alert('No streams available for this channel');
    return;
  }
  if (playbackInProgress) return;
  playbackInProgress = true;

  const currentUrlForCheck = channelData.streams[currentStreamIndex];
  streamAttemptCounts[currentUrlForCheck] = streamAttemptCounts[currentUrlForCheck] || 0;
  if (streamAttemptCounts[currentUrlForCheck] >= MAX_ATTEMPTS_PER_STREAM) {
    playbackInProgress = false;
    alert('Stream failed after multiple attempts. Please try another stream.');
    return;
  }

  const video = document.getElementById('player');
  const url = channelData.streams[currentStreamIndex];
  const isHLS = url.includes('.m3u8') || url.includes('/hls/');
  let triedProxy = false;
  let streamUrl = url; // try direct URL first
  const forceDirectLoad = shouldLoadDirect(url);
  
  // If the page is served over HTTPS and the stream URL is insecure (http),
  // force use of the backend proxy to avoid browser Mixed Content blocking.
  // BUT skip proxy for CloudFront-protected streams (they need direct browser access)
  try {
    const isHttpsPage = window.location.protocol === 'https:';
    // Proxy if page is HTTPS and the source is insecure OR when it's an HLS manifest
    // BUT NOT for direct-only streams (CloudFront protected)
    if (!forceDirectLoad && isHttpsPage && (url.startsWith('http://') || isHLS)) {
      streamUrl = `/proxy?url=${encodeURIComponent(url)}`;
      triedProxy = true; // already using proxy
      console.log('Using backend proxy for stream due to HTTPS/CORS/HLS');
    } else if (forceDirectLoad) {
      console.log('Loading stream directly (CloudFront protected, no proxy)');
      triedProxy = true; // prevent proxy fallback for these streams
    }
  } catch (e) {
    // ignore - defensive
  }
  
  // Clean up existing player
  if (window.hls) {
    window.hls.destroy();
    window.hls = null;
  }
  
  video.pause();
  video.removeAttribute('src');
  video.load();
  
  console.log(`Loading stream: ${url.substring(0, 80)}...`);
  
  if (isHLS && Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      debug: false,
      xhrSetup: function(xhr, url) {
        xhr.withCredentials = false;
      }
    });
    window.hls = hls;
    
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
    
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log('✓ Manifest loaded, starting playback...');
      video.play().catch(e => {
        console.log("Playback error:", e.message);
        playbackInProgress = false;
      });
    });
    
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.error(`✗ Stream failed (${data.type}): ${data.details}`);
        const isManifestOrNetwork = data.type === Hls.ErrorTypes.NETWORK_ERROR || data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR;
        if (!triedProxy && isManifestOrNetwork) {
          triedProxy = true;
          streamAttemptCounts[url] = (streamAttemptCounts[url] || 0) + 1;
          // destroy and retry with proxy
          try { hls.destroy(); } catch (e) {}
          window.hls = null;
          streamUrl = `/proxy?url=${encodeURIComponent(url)}`;
          // small delay to avoid tight loop
          setTimeout(() => {
            playbackInProgress = false;
            startPlayback();
          }, 300);
          return;
        }
        // Give up on this stream after attempts
        streamAttemptCounts[url] = (streamAttemptCounts[url] || 0) + 1;
        playbackInProgress = false;
        tryNextStream();
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // For native HLS (iOS), try direct URL first and fallback to proxy on error
    video.src = streamUrl;
    video.addEventListener('loadedmetadata', () => {
      console.log('✓ Stream loaded (native HLS)');
      video.play().catch(e => console.log("Playback error:", e.message));
      playbackInProgress = false;
    });
    video.addEventListener('error', () => {
      if (!triedProxy) {
        triedProxy = true;
        streamAttemptCounts[url] = (streamAttemptCounts[url] || 0) + 1;
        video.src = `/proxy?url=${encodeURIComponent(url)}`;
        video.load();
        video.play().catch(() => {
          playbackInProgress = false;
          tryNextStream();
        });
      } else {
        playbackInProgress = false;
        tryNextStream();
      }
    });
  } else {
    // Non-HLS assets: try direct then proxy
    video.src = streamUrl;
    video.play().catch(e => {
      console.log("Playback error:", e.message);
      if (!triedProxy) {
        triedProxy = true;
        streamAttemptCounts[url] = (streamAttemptCounts[url] || 0) + 1;
        video.src = `/proxy?url=${encodeURIComponent(url)}`;
        video.play().catch(e2 => {
          console.log("Proxy playback error:", e2.message);
          playbackInProgress = false;
          tryNextStream();
        });
      } else {
        playbackInProgress = false;
        tryNextStream();
      }
    });
  }
}

function tryNextStream() {
  if (!channelData) return;
  
  currentStreamIndex++;
  if (currentStreamIndex < channelData.streams.length) {
    console.log(`⏭ Trying next stream ${currentStreamIndex + 1}/${channelData.streams.length}`);
    startPlayback();
  } else {
    console.log(`✗ All streams failed`);
    alert('All streams failed. Please try again later.');
  }
}

// Initial load
loadChannel();

