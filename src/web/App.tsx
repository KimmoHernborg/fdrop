import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type Me, type SharedFile, deleteFile, getFiles, getMe, signOut, uploadFile } from "./api";
import { Dropzone } from "./Dropzone";
import { FileList, type Upload } from "./FileList";

const SIGN_IN_ERRORS: Record<string, string> = {
  provider: "Could not reach the sign-in service. Try again in a moment.",
  state: "That sign-in attempt expired. Start again.",
  signin: "Sign-in did not complete. Start again.",
};

type Session = { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; me: Me };

export function App() {
  const [session, setSession] = useState<Session>({ status: "loading" });
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const cancels = useRef(new Map<string, () => void>());

  const handleError = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 401) setSession({ status: "signed-out" });
    else setNotice(cause instanceof Error ? cause.message : "Something went wrong.");
  }, []);

  useEffect(() => {
    const error = new URLSearchParams(location.search).get("error");
    if (error) {
      setNotice(SIGN_IN_ERRORS[error] ?? "Sign-in did not complete. Start again.");
      history.replaceState(null, "", "/");
    }
    getMe()
      .then(async (me) => {
        setFiles(await getFiles());
        setSession({ status: "signed-in", me });
      })
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) setSession({ status: "signed-out" });
        else {
          setSession({ status: "signed-out" });
          setNotice("Could not reach the server. Reload to try again.");
        }
      });
  }, []);

  const patchUpload = (key: string, patch: Partial<Upload>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  const dropUpload = (key: string) => {
    cancels.current.delete(key);
    setUploads((list) => list.filter((u) => u.key !== key));
  };

  const startUploads = useCallback(
    (picked: File[]) => {
      for (const file of picked) {
        const key = crypto.randomUUID();
        setUploads((list) => [{ key, filename: file.name, size: file.size, progress: 0, error: null }, ...list]);
        const { done, cancel } = uploadFile(file, (progress) => patchUpload(key, { progress }));
        cancels.current.set(key, cancel);
        done
          .then((saved) => {
            dropUpload(key);
            setFiles((list) => [saved, ...list]);
          })
          .catch((cause: unknown) => {
            if (cause instanceof ApiError && cause.status === 401) return handleError(cause);
            if (cause instanceof ApiError && cause.message === "Upload cancelled.") return dropUpload(key);
            patchUpload(key, { error: cause instanceof Error ? cause.message : "Upload failed." });
          });
      }
    },
    [handleError],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await deleteFile(id);
        setFiles((list) => list.filter((f) => f.id !== id));
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) setFiles((list) => list.filter((f) => f.id !== id));
        else handleError(cause);
      }
    },
    [handleError],
  );

  if (session.status === "loading") return <div className="page" aria-busy="true" />;

  if (session.status === "signed-out") {
    return (
      <div className="page">
        <header className="bar">
          <span className="mark">fdrop</span>
        </header>
        <main className="gate">
          <h1 className="headline">Share a file with a link.</h1>
          <p className="lede">Sign in to upload. Anyone with a link can download, no account needed.</p>
          {notice && (
            <p className="notice" role="alert">
              {notice}
            </p>
          )}
          <a className="button button-primary" href="/auth/login">
            Sign in with Pocket ID
          </a>
        </main>
      </div>
    );
  }

  const { me } = session;
  return (
    <div className="page">
      <header className="bar">
        <span className="mark">fdrop</span>
        <span className="who">
          <span className="who-name">{me.name}</span>
          <button
            className="link"
            type="button"
            onClick={() =>
              signOut()
                .catch(() => {})
                .then(() => location.reload())
            }
          >
            Sign out
          </button>
        </span>
      </header>

      <main>
        <Dropzone me={me} onFiles={startUploads} onReject={setNotice} />
        {notice && (
          <p className="notice" role="alert">
            {notice}
            <button className="link" type="button" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </p>
        )}
        <FileList
          files={files}
          uploads={uploads}
          onDelete={remove}
          onCancel={(key) => cancels.current.get(key)?.()}
          onDismiss={dropUpload}
          onExpired={(id) => setFiles((list) => list.filter((f) => f.id !== id))}
        />
      </main>
    </div>
  );
}
