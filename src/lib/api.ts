import type { T } from "./i18n";

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, public extra?: Record<string, unknown>) {
    super(code);
  }
}

/** Calls the REST API. Throws ApiFailure with a stable error code the UI can translate. */
export async function api<R = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<R> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiFailure(0, "network");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiFailure(res.status, data?.error?.code ?? "server_error", data?.error);
  return data as R;
}

export function errorText(t: T, err: unknown) {
  const code = err instanceof ApiFailure ? err.code : "server_error";
  const key = `errors.${code}`;
  const text = t(key);
  return text === key ? t("errors.server_error") : text;
}

type StoredFile = { id: string; name: string; ext: string; size: number; type: string };

/**
 * Uploads one file with progress and resolves to the stored file's metadata.
 * The server decides the route: through our own API (local disk), or straight from the browser to the
 * file store (Vercel Blob), which is not bound by the host's request-size limit.
 */
export async function uploadFile(
  file: File,
  opts: { purpose?: "resource" | "image"; onProgress?: (fraction: number) => void } = {},
): Promise<StoredFile> {
  const purpose = opts.purpose ?? "resource";
  const start = await api<{ mode: "form" } | { mode: "direct"; pathname: string }>("/uploads/start", { body: { name: file.name, size: file.size, purpose } });

  if (start.mode === "direct") {
    try {
      const { upload } = await import("@vercel/blob/client");
      await upload(start.pathname, file, {
        access: "public",
        handleUploadUrl: "/api/v1/uploads/blob",
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: (e) => opts.onProgress?.(e.percentage / 100),
      });
    } catch {
      throw new ApiFailure(0, "upload_failed");
    }
    return (await api<{ file: StoredFile }>("/uploads/complete", { body: { pathname: start.pathname, name: file.name, purpose } })).file;
  }

  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("purpose", purpose);
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/uploads");
    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiFailure(0, "network"));
    xhr.onload = () => {
      let data: { file?: StoredFile; error?: { code?: string } } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error page */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data?.file) resolve(data.file);
      else reject(new ApiFailure(xhr.status, data?.error?.code ?? "server_error"));
    };
    xhr.send(form);
  });
}
