import { handle } from "hono/vercel";
import { api } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Seconds a request may run on serverless hosts: room for uploads and for the assistant's streamed replies. */
export const maxDuration = 60;

const handler = handle(api);
export { handler as GET, handler as POST, handler as PATCH, handler as PUT, handler as DELETE };
