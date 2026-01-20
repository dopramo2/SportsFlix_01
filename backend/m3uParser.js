
import axios from "axios";
import { matchChannel, getLogo } from "./channelMap.js";

// Parse standard M3U format with #EXTINF
export async function parseM3U(source, extractLogos=false) {
  const data = source.startsWith("http")
    ? (await axios.get(source)).data
    : source;

  const lines = data.split("\n");
  let current=null;
  const out=[];

  // Check if it's standard M3U format or custom format
  const hasExtinf = lines.some(l => l.trim().startsWith("#EXTINF"));
  
  if (hasExtinf) {
    // Standard M3U format
    for (let l of lines) {
      l=l.trim();
      if (l.startsWith("#EXTINF")) {
        const name=l.split(",").pop();
        let logo = null;
        if (extractLogos) {
          logo = l.match(/tvg-logo="([^"]+)"/)?.[1] || 
                 l.match(/tvg-logo=([^\s]+)/)?.[1] ||
                 l.match(/logo="([^"]+)"/)?.[1] ||
                 l.match(/logo=([^\s]+)/)?.[1];
          if (logo) {
            logo = logo.replace(/^["']|["']$/g, '');
          }
        }
        const matched = matchChannel(name || "");
        if (matched) {
          current={channel:matched,logo:logo};
        } else current=null;
      } else if (current && l.startsWith("http")) {
        out.push({channel:current.channel,logo:current.logo,url:l});
        current=null;
      }
    }
  } else {
    // Custom format: Name / URL / Logo (optional) / blank line
    const cleanLines = lines.map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    let i = 0;
    while (i < cleanLines.length) {
      const name = cleanLines[i];
      if (!name) { i++; continue; }
      
      // Check if next line is a URL
      let streamUrl = "";
      let logoUrl = "";
      
      if (i + 1 < cleanLines.length && cleanLines[i + 1].startsWith("http")) {
        streamUrl = cleanLines[i + 1];
        i += 2;
        
        // Check if next line is a logo URL (http) or local path
        if (i < cleanLines.length && (cleanLines[i].startsWith("http") || cleanLines[i].includes(".png") || cleanLines[i].includes(".jpg") || cleanLines[i].includes(".svg"))) {
          logoUrl = cleanLines[i];
          i++;
        }
      } else {
        i++;
        continue;
      }
      
      const matched = matchChannel(name);
      if (matched && streamUrl) {
        out.push({channel: matched, logo: logoUrl || null, url: streamUrl});
      }
    }
  }
  return out;
}

// Parse M3U without filtering - returns all channels with their original names
export async function parseM3UAll(source, extractLogos=false) {
  const data = source.startsWith("http")
    ? (await axios.get(source)).data
    : source;

  const lines = data.split("\n");
  let current=null;
  const out=[];

  // Check if it's standard M3U format or custom format
  const hasExtinf = lines.some(l => l.trim().startsWith("#EXTINF"));
  
  if (hasExtinf) {
    // Standard M3U format
    for (let l of lines) {
      l=l.trim();
      if (l.startsWith("#EXTINF")) {
        const name=l.split(",").pop();
        let logo = null;
        if (extractLogos) {
          logo = l.match(/tvg-logo="([^"]+)"/)?.[1] || 
                 l.match(/tvg-logo=([^\s]+)/)?.[1] ||
                 l.match(/logo="([^"]+)"/)?.[1] ||
                 l.match(/logo=([^\s]+)/)?.[1];
          if (logo) {
            logo = logo.replace(/^["']|["']$/g, '');
          }
        }
        const normalizedName = (name || "").toLowerCase().trim();
        if (normalizedName) {
          current={channel:normalizedName,logo:logo};
        } else current=null;
      } else if (current && l.startsWith("http")) {
        out.push({channel:current.channel,logo:current.logo,url:l});
        current=null;
      }
    }
  } else {
    // Custom format: Name / URL / Logo (optional) / blank line
    const cleanLines = lines.map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    let i = 0;
    while (i < cleanLines.length) {
      const name = cleanLines[i];
      if (!name) { i++; continue; }
      
      // Check if next line is a URL
      let streamUrl = "";
      let logoUrl = "";
      
      if (i + 1 < cleanLines.length && cleanLines[i + 1].startsWith("http")) {
        streamUrl = cleanLines[i + 1];
        i += 2;
        
        // Check if next line is a logo URL (http) or local path
        if (i < cleanLines.length && (cleanLines[i].startsWith("http") || cleanLines[i].includes(".png") || cleanLines[i].includes(".jpg") || cleanLines[i].includes(".svg"))) {
          logoUrl = cleanLines[i];
          i++;
        }
      } else {
        i++;
        continue;
      }
      
      const normalizedName = name.toLowerCase().trim();
      if (normalizedName && streamUrl) {
        out.push({channel: normalizedName, logo: logoUrl || null, url: streamUrl});
      }
    }
  }
  return out;
}
