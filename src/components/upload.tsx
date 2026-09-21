"use client";
import { useRef, useState } from "react";
import { Button, LinearProgress, Alert } from "@mui/material";
import { request } from "./client-api";
type Init = { id: string; mode: string; partSize: number; partCount: number };
export default function Upload({
  orderId,
  onDone,
}: {
  orderId: string;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState("");
  const cancelled = useRef(false);
  const current = useRef("");
  const active = useRef(new Set<XMLHttpRequest>());
  async function upload() {
    if (!file) return;
    cancelled.current = false;
    setBusy(true);
    setMessage("");
    setProgress(0);
    let init: Init | undefined;
    try {
      init = await request<Init>("uploads/initiate", {
        orderId,
        originalFilename: file.name,
        declaredSize: file.size,
        contentType: file.type || "application/pdf",
      });
      current.current = init.id;
      setMode(init.mode);
      const loaded: number[] = Array(init.partCount).fill(0);
      const completed: { part: number; etag?: string; receipt?: string }[] = [];
      let next = 1;
      const report = (part: number, size: number) => {
        loaded[part - 1] = size;
        setProgress(
          Math.min(99, (loaded.reduce((a, b) => a + b, 0) / file.size) * 100),
        );
      };
      const worker = async () => {
        while (next <= init!.partCount) {
          const part = next++;
          const chunk = file!.slice(
            (part - 1) * init!.partSize,
            part * init!.partSize,
          );
          let done = false;
          for (let attempt = 0; attempt < 3 && !done; attempt++) {
            if (cancelled.current) throw new Error("Upload cancelled.");
            try {
              const signed = await request<{
                parts: { url: string; receipt?: string }[];
              }>("uploads/sign-parts", { assetId: init!.id, parts: [part] });
              const ticket = signed.parts[0];
              if (init!.mode === "simulation") {
                for (let step = 1; step <= 8; step++) {
                  await new Promise((r) => setTimeout(r, 200));
                  if (cancelled.current) throw new Error("Upload cancelled.");
                  report(part, (chunk.size * step) / 8);
                }
                completed.push({ part, receipt: ticket.receipt });
              } else {
                const etag = await new Promise<string>((resolve, reject) => {
                  const xhr = new XMLHttpRequest();
                  active.current.add(xhr);
                  xhr.open("PUT", ticket.url);
                  xhr.timeout = 120000;
                  xhr.upload.onprogress = (e) => report(part, e.loaded);
                  xhr.onload = () => {
                    active.current.delete(xhr);
                    if (
                      xhr.status >= 200 &&
                      xhr.status < 300 &&
                      xhr.getResponseHeader("ETag")
                    )
                      resolve(xhr.getResponseHeader("ETag")!);
                    else reject(new Error("Storage rejected a file part."));
                  };
                  xhr.onerror = xhr.ontimeout = () => {
                    active.current.delete(xhr);
                    reject(new Error("Part upload failed."));
                  };
                  xhr.onabort = () => reject(new Error("Upload cancelled."));
                  xhr.send(chunk);
                });
                completed.push({ part, etag });
              }
              done = true;
            } catch (error) {
              if (attempt === 2 || cancelled.current) throw error;
              await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
            }
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(3, init.partCount) }, worker),
      );
      if (cancelled.current) throw new Error("Upload cancelled.");
      await request("uploads/complete", { assetId: init.id, parts: completed });
      setProgress(100);
      setMessage(
        init.mode === "simulation"
          ? "Simulation complete. No file bytes were stored."
          : "File uploaded and verified.",
      );
      onDone();
    } catch (error) {
      cancelled.current = true;
      active.current.forEach((x) => x.abort());
      if (init) {
        try {
          await request("uploads/fail", { assetId: init.id });
        } catch {}
      }
      setMessage(
        error instanceof Error
          ? error.message
          : "Upload failed. You can retry.",
      );
      onDone();
    } finally {
      setBusy(false);
      current.current = "";
    }
  }
  return (
    <div className="upload-box">
      <strong>Add a production asset</strong>
      <p className="muted">PDF, PNG, JPEG or TIFF · up to 2 GiB</p>
      <input
        aria-label="Choose production asset"
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff"
        disabled={busy}
        onChange={(e) => {
          setFile(e.target.files?.[0]);
          setMessage("");
        }}
      />
      <div className="button-row">
        <Button
          variant="outlined"
          disabled={!file || busy}
          onClick={() => void upload()}
        >
          {message && progress < 100 ? "Retry upload" : "Upload asset"}
        </Button>
        {busy && (
          <Button
            color="error"
            onClick={() => {
              cancelled.current = true;
              active.current.forEach((x) => x.abort());
              if (current.current)
                void request("uploads/abort", {
                  assetId: current.current,
                }).catch(() => {});
            }}
          >
            Cancel
          </Button>
        )}
      </div>
      {busy && (
        <>
          <LinearProgress variant="determinate" value={progress} />
          <small>
            {mode === "simulation" ? "Simulated upload" : "Uploading"} ·{" "}
            {Math.round(progress)}%
          </small>
        </>
      )}
      {message && (
        <Alert severity={progress === 100 ? "success" : "info"}>
          {message}
        </Alert>
      )}
    </div>
  );
}
