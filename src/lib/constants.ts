/** Shared by server and client. Display names live in messages/*.json. */

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export const COLORS = ["green", "blue", "plum", "coral", "ochre", "teal"] as const;
export type ColorName = (typeof COLORS)[number];

export const SECTION_ICONS = [
  "folder", "video", "presentation", "image", "clipboard", "pencil", "file", "link", "box",
  "book", "star", "puzzle", "music", "mic", "award", "calendar",
] as const;

export const RESOURCE_TYPES = [
  "pdf", "presentation", "document", "spreadsheet", "image", "video", "link", "note",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/** Allowed uploads: extension → resource type + accepted MIME types. */
export const FILE_TYPES: Record<string, { type: ResourceType; mimes: string[] }> = {
  pdf: { type: "pdf", mimes: ["application/pdf"] },
  ppt: { type: "presentation", mimes: ["application/vnd.ms-powerpoint"] },
  pptx: { type: "presentation", mimes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"] },
  doc: { type: "document", mimes: ["application/msword"] },
  docx: { type: "document", mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  xls: { type: "spreadsheet", mimes: ["application/vnd.ms-excel"] },
  xlsx: { type: "spreadsheet", mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
  png: { type: "image", mimes: ["image/png"] },
  jpg: { type: "image", mimes: ["image/jpeg"] },
  jpeg: { type: "image", mimes: ["image/jpeg"] },
  webp: { type: "image", mimes: ["image/webp"] },
  mp4: { type: "video", mimes: ["video/mp4"] },
  mov: { type: "video", mimes: ["video/quicktime"] },
};
export const ACCEPT_UPLOAD = Object.keys(FILE_TYPES).map((e) => `.${e}`).join(",");

/** Which default section a resource type lands in when nothing more specific is known. */
export const TYPE_TO_SECTION: Record<ResourceType, string> = {
  pdf: "files", presentation: "presentations", document: "files", spreadsheet: "files",
  image: "images", video: "videos", link: "links", note: "lesson_plans",
};

export function academicYears(now = new Date()): string[] {
  // School years start in late summer: from August on, the current year opens a new one.
  const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return [start - 1, start, start + 1].map((y) => `${y}/${y + 1}`);
}
export function currentAcademicYear(now = new Date()): string {
  return academicYears(now)[1];
}
