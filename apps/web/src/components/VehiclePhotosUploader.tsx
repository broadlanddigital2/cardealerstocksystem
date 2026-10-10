import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ObjectUploader } from "@workspace/object-storage-web";
import { Star, Upload, X } from "lucide-react";

interface VehiclePhotosUploaderProps {
  value: Array<string>;
  onChange: (urls: Array<string>) => void;
}

// Multi-photo manager for the public showroom. Uploads images to object storage
// (returning normalized /objects/<id> paths) and lets the dealer remove or
// reorder by removal. The saved paths are made public-read on the server when
// the vehicle is saved.
export function VehiclePhotosUploader({
  value,
  onChange,
}: VehiclePhotosUploaderProps) {
  const { getToken } = useAuth();
  // Maps each Uppy file id to the object path issued for it, so a multi-file
  // upload can collect every resulting path in onComplete.
  const pathMap = useRef<Map<string, string>>(new Map());
  // Local blob preview URLs for photos uploaded in THIS session, keyed by their
  // object path. A freshly uploaded object has no public ACL until the vehicle
  // is saved, so serving it back via /api/storage/objects/<id> would 403 and
  // render a broken thumbnail. Previewing from the in-memory file avoids that.
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const blobUrlsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    blobUrlsRef.current = blobUrls;
  }, [blobUrls]);
  useEffect(() => {
    return () => {
      Object.values(blobUrlsRef.current).forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {value.map((p, i) => (
            <div key={p} className="relative group">
              <img
                src={blobUrls[p] ?? `/api/storage${p}`}
                alt={`Vehicle photo ${i + 1}`}
                className="h-24 w-full object-cover rounded-md border border-slate-200"
              />
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => {
                  const url = blobUrls[p];
                  if (url) {
                    URL.revokeObjectURL(url);
                    setBlobUrls((prev) => {
                      const next = { ...prev };
                      delete next[p];
                      return next;
                    });
                  }
                  onChange(value.filter((x) => x !== p));
                }}
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
              {i === 0 ? (
                <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                  <Star className="h-3 w-3 fill-current" /> Main
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    onChange([p, ...value.filter((x) => x !== p)])
                  }
                  className="absolute bottom-1 left-1 inline-flex items-center gap-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                >
                  <Star className="h-3 w-3" /> Set as main
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <ObjectUploader
        maxNumberOfFiles={10}
        allowedFileTypes={["image/jpeg", "image/png", "image/gif", "image/webp"]}
        onGetUploadParameters={async (file) => {
          const token = await getToken();
          const res = await fetch("/api/storage/uploads/request-url", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              name: file.name,
              size: file.size,
              contentType: file.type,
            }),
          });
          if (!res.ok) {
            throw new Error(`Failed to start upload (${res.status})`);
          }
          const { uploadURL, objectPath } = await res.json();
          pathMap.current.set(file.id, objectPath);
          return {
            method: "PUT",
            url: uploadURL,
            headers: { "Content-Type": file.type },
          };
        }}
        onComplete={(result) => {
          const added: Array<string> = [];
          const newBlobs: Record<string, string> = {};
          for (const f of result.successful ?? []) {
            const p = pathMap.current.get(f.id);
            if (p && !value.includes(p)) {
              added.push(p);
              if (f.data) newBlobs[p] = URL.createObjectURL(f.data as Blob);
            }
          }
          if (Object.keys(newBlobs).length > 0) {
            setBlobUrls((prev) => ({ ...prev, ...newBlobs }));
          }
          if (added.length) onChange([...value, ...added]);
          pathMap.current.clear();
        }}
        buttonClassName="w-full inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
      >
        <Upload className="h-4 w-4 mr-2" /> Upload Photos
      </ObjectUploader>
      <p className="text-xs text-slate-500">
        The photo marked "Main" is used as the main image on the website. Hover
        a photo and choose "Set as main" to change it. Upload up to 10 images
        (JPEG, PNG, GIF or WebP).
      </p>
    </div>
  );
}
