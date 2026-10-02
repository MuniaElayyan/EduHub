import {
  Award, BookOpen, Box, Calendar, ClipboardList, FileSpreadsheet, FileText, Folder, Image as ImageIcon, Link2, Mic, Music,
  PencilLine, Presentation, Puzzle, Star, StickyNote, Video, type LucideIcon,
} from "lucide-react";
import type { ResourceType } from "@/lib/constants";

export const SECTION_ICON: Record<string, LucideIcon> = {
  folder: Folder, video: Video, presentation: Presentation, image: ImageIcon, clipboard: ClipboardList,
  pencil: PencilLine, file: FileText, link: Link2, box: Box, book: BookOpen, star: Star, puzzle: Puzzle,
  music: Music, mic: Mic, award: Award, calendar: Calendar,
};

export const TYPE_ICON: Record<ResourceType, LucideIcon> = {
  pdf: FileText, presentation: Presentation, document: FileText, spreadsheet: FileSpreadsheet,
  image: ImageIcon, video: Video, link: Link2, note: StickyNote,
};

/** Cover colour per resource type, from the same palette as the notebooks. */
export const TYPE_COLOR: Record<ResourceType, string> = {
  pdf: "coral", presentation: "ochre", document: "blue", spreadsheet: "green",
  image: "teal", video: "plum", link: "blue", note: "green",
};

export const PROVIDER_NAME: Record<string, string> = {
  youtube: "YouTube", canva: "Canva", gamma: "Gamma", gdrive: "Google Drive",
  gdocs: "Google Docs", gslides: "Google Slides", gsheets: "Google Sheets",
};
