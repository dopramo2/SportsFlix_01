
// Register Service Worker for CORS handling (needed for CricHD)
let serviceWorkerReady = false;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(registration => {
    console.log('Service Worker registered for CORS handling');
    
    // Wait for service worker to be active
    if (registration.active) {
      serviceWorkerReady = true;
      console.log('✓ Service Worker is active and ready');
    } else {
      // Wait for activation
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated') {
            serviceWorkerReady = true;
            console.log('✓ Service Worker activated');
            // Reload the page to ensure SW controls all requests
            if (!navigator.serviceWorker.controller) {
              console.log('↻ Reloading page for Service Worker control...');
              window.location.reload();
            }
          }
        });
      });
    }
    
    // Check if SW is already controlling the page
    if (navigator.serviceWorker.controller) {
      serviceWorkerReady = true;
      console.log('✓ Service Worker is controlling the page');
    }
  }).catch(err => {
    console.warn('Service Worker registration failed:', err);
  });
} else {
  console.warn('Service Workers not supported in this browser');
}

let channels = {};
let currentChannel = null;
let currentStreamIndex = 0;

// Unified source: we load both CricHD and M3U together from the backend.

function loadChannels() {
  // Unified endpoint returns combined CricHD + M3U channels. Each channel object includes
  // a `source` property ('crichd' or 'm3u') used internally for stream-testing only.
  const endpoint = '/api/all-channels';
  
  return fetch(endpoint)
  .then(r=>r.json())
  .then(d=>{
    channels = d;
    displayChannels(d);
    return d;
  })
  .catch(err=>{
    console.error("Failed to load channels:", err);
    document.getElementById("channels").innerHTML = 
      '<div style="color:red;padding:20px">Failed to load channels</div>';
    return {};
  });
}

function displayChannels(channelData) {
  const container=document.getElementById("channels");
  container.innerHTML = "";
  
  // Channels are already sorted by backend, just use them in order
  const channelEntries = Object.entries(channelData);
  
  channelEntries.forEach(([name,data], index)=>{
    const card=document.createElement("div");
    card.className="channel-card";
    card.dataset.channelName = name;
    
    // Add channel logo if available
    if(data.logo) {
      const img=document.createElement("img");
      img.src=data.logo;
      img.alt=name;
      img.onerror = () => img.style.display = "none";
      card.appendChild(img);
    }
    
    const channelName=document.createElement("div");
    channelName.className="channel-name";
    channelName.textContent=name.toUpperCase();
    channelName.title=name;
    card.appendChild(channelName);
    
    const count=document.createElement("div");
    count.className="stream-count";
    count.textContent=`${data.streams.length} stream${data.streams.length>1?"s":""}`;
    card.appendChild(count);
    
    card.onclick=()=>selectChannel(name, data);
    container.appendChild(card);
  });
  
  // Initialize pagination
  initPagination();
}

// Check for channel parameter in URL and auto-select
const urlParams = new URLSearchParams(window.location.search);
const channelParam = urlParams.get('channel');
const sourceParam = urlParams.get('source');

// Initial load
loadChannels().then(() => {
  if (channelParam) {
    // Set source if provided
    if (sourceParam && (sourceParam === 'crichd' || sourceParam === 'm3u')) {
      if (currentSource !== sourceParam) {
        switchSource(sourceParam);
      }
    }
    // Wait a bit for channels to render, then select the channel
    setTimeout(() => {
      const channelName = decodeURIComponent(channelParam);
      if (channels[channelName]) {
        selectChannel(channelName, channels[channelName]);
      }
    }, 800);
  }
});

// Pagination variables
let currentPage = 0;
const channelsPerPage = 6;
let totalChannels = 0;

function initPagination() {
  const allChannels = document.querySelectorAll('.channel-card');
  totalChannels = allChannels.length;
  currentPage = 0;
  updatePagination();
  
  // Add event listeners to navigation buttons
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  
  prevBtn.onclick = () => {
    if (currentPage > 0) {
      currentPage--;
      updatePagination();
    }
  };
  
  nextBtn.onclick = () => {
    if ((currentPage + 1) * channelsPerPage < totalChannels) {
      currentPage++;
      updatePagination();
    }
  };
}

function updatePagination() {
  const allChannels = document.querySelectorAll('.channel-card');
  const start = currentPage * channelsPerPage;
  const end = start + channelsPerPage;
  
  allChannels.forEach((channel, index) => {
    if (index >= start && index < end) {
      channel.style.display = 'block';
    } else {
      channel.style.display = 'none';
    }
  });
  
  // Update button states
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  
  prevBtn.disabled = currentPage === 0;
  nextBtn.disabled = end >= totalChannels;
}

function selectChannel(name, data) {
  // Keep the original channel data but ensure we have the backend-provided `source`
  // flag available on the current selection for internal behavior (UI doesn't show it).
  currentChannel = { name, data };
  currentStreamIndex = 0;
  
  // Stop any currently playing stream
  const video = document.getElementById("player");
  if(window.hls) {
    window.hls.destroy();
    window.hls = null;
  }
  video.pause();
  video.removeAttribute('src');
  video.load();
  
  // Update UI - highlight selected channel
  document.querySelectorAll(".channel-card").forEach(c => c.classList.remove("active"));
  const clickedCard = document.querySelector(`[data-channel-name="${name}"]`);
  if (clickedCard) {
    clickedCard.classList.add("active");
  }
  
  // Show stream selector
  showStreamSelector();
}

async function showStreamSelector() {
  const panel = document.getElementById("stream-panel");
  panel.innerHTML = "";
  panel.style.display = "flex";
  
  // Show updating message
  const loadingMsg = document.createElement("div");
  loadingMsg.style.cssText = "padding:20px;color:#00d4ff;text-align:center;width:100%;font-size:16px;";
  loadingMsg.innerHTML = `
    <div style="font-size:18px;margin-bottom:10px;">🔄 Updating links...</div>
    <div style="color:#888;font-size:14px;">Testing ${currentChannel.data.streams.length} streams</div>
  `;
  panel.appendChild(loadingMsg);
  
  // Test all streams and filter working ones (only for M3U source)
  let workingStreams = [];
  const isM3U = (currentChannel.data && currentChannel.data.source === 'm3u') || false;
  if (isM3U) {
    for (let i = 0; i < currentChannel.data.streams.length; i++) {
      const url = currentChannel.data.streams[i];
      const isWorking = await testStream(url);
      if (isWorking) {
        workingStreams.push({ url, originalIndex: i });
      }
      loadingMsg.innerHTML = `
        <div style="font-size:18px;margin-bottom:10px;">🔄 Updating links...</div>
        <div style="color:#888;font-size:14px;">Tested ${i + 1}/${currentChannel.data.streams.length} - Found ${workingStreams.length} working</div>
      `;
    }
  } else {
    // For CricHD, show all streams without testing
    workingStreams = currentChannel.data.streams.map((url, i) => ({ url, originalIndex: i }));
  }
  
  // Clear panel and show working streams
  panel.innerHTML = "";
  
  if (workingStreams.length === 0) {
    const noStreamsMsg = document.createElement("div");
    noStreamsMsg.style.cssText = "padding:20px;color:#ff4444;text-align:center;width:100%;";
    noStreamsMsg.innerHTML = `
      <div style="font-size:18px;margin-bottom:10px;">❌ No working streams</div>
      <div style="color:#888;font-size:14px;">All streams are currently unavailable for this channel</div>
    `;
    panel.appendChild(noStreamsMsg);
    return;
  }
  
  // Create buttons for working streams only
  workingStreams.forEach((stream, idx) => {
    const btn = document.createElement("button");
    btn.className = "stream-btn";
    btn.textContent = `Stream ${idx + 1}`;
    btn.onclick = () => playStream(stream.originalIndex);
    if (idx === 0) {
      btn.classList.add("active");
    }
    panel.appendChild(btn);
  });
  
  // Store working streams info
  currentChannel.workingStreams = workingStreams;
  
  // Auto-play first working stream
  if (workingStreams.length > 0) {
    playStream(workingStreams[0].originalIndex);
  }
}

async function testStream(url) {
  try {
    // Use backend endpoint for stream validation
    const response = await fetch('/api/check-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await response.json();
    return data.online === true;
  } catch (e) {
    console.error('Stream test error:', e);
    return false;
  }
}

function playStream(index) {
  currentStreamIndex = index;
  const url = currentChannel.data.streams[index];
  const video = document.getElementById("player");
  
  // Highlight active stream button
  document.querySelectorAll('.stream-btn').forEach((btn, idx) => {
    btn.classList.toggle('active', idx === index);
  });
  
  // Clean up any existing player
  if(window.hls) {
    window.hls.destroy();
    window.hls = null;
  }
  
  video.pause();
  video.removeAttribute('src');
  video.load();
  
  console.log(`Loading stream ${index + 1}: ${url.substring(0, 80)}...`);
  
  // Use backend proxy for ALL streams to bypass CORS errors (service worker can't bypass CORS)
  const streamUrl = `/proxy?url=${encodeURIComponent(url)}`;
  console.log('Using backend proxy to bypass CORS');
  
  // Check if it's an HLS stream
  const isHLS = url.includes('.m3u8') || url.includes('/hls/');
  
  if(isHLS && Hls.isSupported()){
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
        console.log("Autoplay blocked:", e.message);
      });
    });
    
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.error(`✗ Stream failed (${data.type}): ${data.details}`);
        // Auto-skip to next stream after a brief delay
        setTimeout(() => tryNextStream(), 1500);
      }
    });
    
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS support (Safari)
    video.src = streamUrl;
    video.addEventListener('loadedmetadata', () => {
      console.log('✓ Stream loaded (native HLS)');
      video.play().catch(e => console.log("Autoplay blocked:", e.message));
    });
    video.addEventListener('error', (e) => {
      console.error('✗ Video error:', e);
      setTimeout(() => tryNextStream(), 2000);
    });
  } else {
    // Direct stream
    video.src = streamUrl;
    video.play().catch(e => {
      console.log("Playback error:", e.message);
      setTimeout(() => tryNextStream(), 2000);
    });
  }
}

function tryNextStream() {
  const streams = currentChannel.data.streams;
  currentStreamIndex++;
  
  if (currentStreamIndex < streams.length) {
    console.log(`⏭ Auto-skipping to stream ${currentStreamIndex + 1}/${streams.length}`);
    playStream(currentStreamIndex);
  } else {
    console.log(`✗ All ${streams.length} streams failed for ${currentChannel.name}`);
    const panel = document.getElementById("stream-panel");
    panel.innerHTML = `
      <div style="padding:20px;color:#ff4444;text-align:center;width:100%;">
        <div style="font-size:18px;margin-bottom:10px;">❌ All streams failed</div>
        <div style="color:#888;font-size:14px;">
          All ${streams.length} streams for ${currentChannel.name} are currently unavailable.
          <br>Try another channel or refresh the page later.
        </div>
      </div>
    `;
  }
}

// Add helpful console message on load
console.log('%c🏆 Sports IPTV Player', 'font-size:20px;font-weight:bold;color:#00d4ff');
console.log('%c💡 Streams auto-skip if they fail to load', 'color:#4CAF50');
console.log('%c⚠️ Many streams have CORS restrictions or expired tokens', 'color:#ff9800');
console.log('%c🔄 If all streams fail, try another channel', 'color:#888');

