import { type FileRejection, useDropzone } from "react-dropzone";
import { type Me, formatSize } from "./api";

interface Props {
  me: Me;
  onFiles: (files: File[]) => void;
  onReject: (message: string) => void;
}

/** react-dropzone walks dropped folders and tags each file with its path inside the drop. */
function cameFromFolder(file: File): boolean {
  const path = (file as File & { path?: string }).path ?? file.webkitRelativePath ?? "";
  return path.replace(/^\.?\//, "").includes("/");
}

export function Dropzone({ me, onFiles, onReject }: Props) {
  const limit = formatSize(me.maxUploadBytes);

  const onDrop = (accepted: File[], rejected: FileRejection[]) => {
    const all = [...accepted, ...rejected.map((r) => r.file)];
    // An empty drop is what a dropped empty folder looks like.
    if (all.length === 0 || all.some(cameFromFolder)) {
      onReject("Folders can't be uploaded. Drop the files themselves, or zip the folder first.");
      return;
    }
    if (rejected.length === 0) onReject("");
    else {
      const names = rejected.map((r) => r.file.name).join(", ");
      onReject(`Too large to upload (limit ${limit} per file): ${names}`);
    }
    if (accepted.length > 0) onFiles(accepted);
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: true,
    maxSize: me.maxUploadBytes,
    noClick: true,
    noKeyboard: true,
  });

  const days = me.retentionDays === 1 ? "1 day" : `${me.retentionDays} days`;

  return (
    <section {...getRootProps({ className: isDragActive ? "drop drop-active" : "drop" })}>
      <input {...getInputProps()} />
      <h1 className="headline">{isDragActive ? "Let go." : "Drop files here."}</h1>
      <p className="lede">
        Each file gets its own link that anyone can download from. Links stop working after {days}. Up to {limit}{" "}
        per file.
      </p>
      <button className="button button-primary" type="button" onClick={open}>
        Choose files
      </button>
    </section>
  );
}
