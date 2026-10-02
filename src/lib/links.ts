import type { ResourceType } from "./constants";

export type LinkInfo = {
  provider: "youtube" | "canva" | "gamma" | "gdrive" | "gdocs" | "gslides" | "gsheets" | "other";
  type: ResourceType;
  thumbnailUrl: string | null;
  host: string;
};

export function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const m = url.pathname.match(/^\/(embed|shorts|live)\/([\w-]{6,})/);
    return m ? m[2] : null;
  }
  return null;
}

/** Recognises well-known services so links get the right card, but accepts any http(s) URL. */
export function inspectLink(raw: string): LinkInfo | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\./, "");

  const yt = youtubeId(url);
  if (yt) {
    return { provider: "youtube", type: "video", host, thumbnailUrl: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` };
  }
  if (host.endsWith("canva.com")) return { provider: "canva", type: "presentation", host, thumbnailUrl: null };
  if (host.endsWith("gamma.app")) return { provider: "gamma", type: "presentation", host, thumbnailUrl: null };
  if (host === "docs.google.com") {
    if (url.pathname.startsWith("/presentation")) return { provider: "gslides", type: "presentation", host, thumbnailUrl: null };
    if (url.pathname.startsWith("/spreadsheets")) return { provider: "gsheets", type: "spreadsheet", host, thumbnailUrl: null };
    return { provider: "gdocs", type: "document", host, thumbnailUrl: null };
  }
  if (host === "drive.google.com") return { provider: "gdrive", type: "link", host, thumbnailUrl: null };
  return { provider: "other", type: "link", host, thumbnailUrl: null };
}
