import type { MediaKind } from "./types";

export type PlaylistDraftFile = {
  name: string;
  type: string;
};

export type PlaylistDraftItem = {
  id: string;
  title: string;
  kind: MediaKind;
  mimeType: string;
  durationSeconds: number;
  hasAudio: boolean;
  previewUrl: string;
};

export function detectMediaKind(file: PlaylistDraftFile): MediaKind | "" {
  const mimeType = file.type.toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase() || "";

  if (mimeType.startsWith("video/") || ["mp4", "webm", "mov", "m4v", "mkv"].includes(extension)) {
    return "video";
  }
  if (mimeType.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(extension)) {
    return "image";
  }
  if (mimeType.startsWith("audio/") || ["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(extension)) {
    return "audio";
  }

  return "";
}

export function getDefaultDurationSeconds(kind: MediaKind) {
  if (kind === "audio") {
    return 180;
  }
  return 10;
}

export function buildPlaylistDraftItem(input: {
  id: string;
  file: PlaylistDraftFile;
  durationSeconds?: number;
  previewUrl?: string;
}): PlaylistDraftItem | null {
  const kind = detectMediaKind(input.file);
  if (!kind) {
    return null;
  }

  const durationSeconds = Math.max(
    Math.round(Number(input.durationSeconds || getDefaultDurationSeconds(kind))) || getDefaultDurationSeconds(kind),
    1
  );

  return {
    id: input.id,
    title: stripFileExtension(input.file.name),
    kind,
    mimeType: input.file.type || mimeTypeForKind(kind),
    durationSeconds,
    hasAudio: kind !== "image",
    previewUrl: input.previewUrl || ""
  };
}

export function buildPlaylistDraftItemFromMedia(input: {
  id: string;
  title: string;
  kind: MediaKind;
  mimeType: string;
  durationSeconds: number;
  hasAudio: boolean;
  previewUrl: string;
}): PlaylistDraftItem {
  const durationSeconds = Math.max(
    Math.round(Number(input.durationSeconds || getDefaultDurationSeconds(input.kind))) || getDefaultDurationSeconds(input.kind),
    1
  );

  return {
    id: input.id,
    title: input.title.trim() || "Media",
    kind: input.kind,
    mimeType: input.mimeType || mimeTypeForKind(input.kind),
    durationSeconds,
    hasAudio: input.kind === "image" ? false : Boolean(input.hasAudio),
    previewUrl: input.previewUrl || ""
  };
}

export function reorderPlaylistDraftItems<T extends { id: string }>(items: T[], activeId: string, overId: string) {
  if (!activeId || !overId || activeId === overId) {
    return items;
  }

  const activeIndex = items.findIndex((entry) => entry.id === activeId);
  const overIndex = items.findIndex((entry) => entry.id === overId);
  if (activeIndex < 0 || overIndex < 0) {
    return items;
  }

  const nextItems = [...items];
  const [moved] = nextItems.splice(activeIndex, 1);
  nextItems.splice(overIndex, 0, moved);
  return nextItems;
}

export function playlistSortOrder(index: number) {
  return (index + 1) * 10;
}

function stripFileExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim() || fileName;
}

function mimeTypeForKind(kind: MediaKind) {
  if (kind === "image") {
    return "image/*";
  }
  if (kind === "audio") {
    return "audio/*";
  }
  return "video/*";
}
