"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Clock3, LoaderCircle, Plus, RefreshCw, UsersRound, X } from "lucide-react";
import { D1_BOOKMARK_HEADER, readD1Bookmark, saveD1Bookmark } from "../d1-bookmark";
import { PUBLIC_LOBBY_ENABLED } from "../../lib/site-features";

type PublicRoom = {
  code: string;
  durationSeconds: number;
  description: string;
  lastSeenAt: string | null;
};

const TOKEN_KEY = "same-word-player";

async function post<T>(payload: Record<string, unknown>): Promise<T> {
  const roomCode = String(payload.code ?? "").trim().toUpperCase();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const bookmark = readD1Bookmark(roomCode || "LOBBY");
  if (bookmark) headers[D1_BOOKMARK_HEADER] = bookmark;
  const response = await fetch("/api/game", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await response.json() as T & { error?: string };
  const dataWithRoom = data as typeof data & { code?: string; room?: { rematch?: { code?: string } | null } };
  saveD1Bookmark(response, ["LOBBY", roomCode, dataWithRoom.code, dataWithRoom.room?.rematch?.code]);
  if (!response.ok) throw new Error(data.error || "操作失败，请重试");
  return data;
}

function enterRoom(code: string, token: string) {
  localStorage.setItem(`${TOKEN_KEY}:${code}`, token);
  window.location.assign(`/?room=${code}`);
}

export default function Lobby() {
  const [rooms, setRooms] = useState<PublicRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [joiningCode, setJoiningCode] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [description, setDescription] = useState("");
  const [durationMode, setDurationMode] = useState<"30" | "60" | "custom">("60");
  const [customDurationSeconds, setCustomDurationSeconds] = useState(90);

  const refreshRooms = useCallback(async (): Promise<boolean> => {
    if (!PUBLIC_LOBBY_ENABLED) return false;
    setRefreshing(true);
    try {
      const headers: Record<string, string> = {};
      const bookmark = readD1Bookmark("LOBBY");
      if (bookmark) headers[D1_BOOKMARK_HEADER] = bookmark;
      const response = await fetch("/api/game?lobby=1", { cache: "no-store", headers });
      const data = await response.json() as { rooms?: PublicRoom[]; error?: string };
      saveD1Bookmark(response, ["LOBBY"]);
      if (!response.ok) throw new Error(data.error || "大厅暂时无法加载");
      setRooms(data.rooms ?? []);
      setError("");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "大厅暂时无法加载");
      return false;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!PUBLIC_LOBBY_ENABLED) return;
    let timer: number | undefined;
    let stopped = false;
    let task: Promise<void> | null = null;
    let failures = 0;

    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const schedule = (delay: number) => {
      clearTimer();
      if (stopped || document.visibilityState !== "visible" || !navigator.onLine) return;
      timer = window.setTimeout(() => { timer = undefined; void poll(); }, delay);
    };
    const poll = (): Promise<void> => {
      if (task) return task;
      if (stopped || document.visibilityState !== "visible") return Promise.resolve();
      task = (async () => {
        if (!navigator.onLine) return;
        const succeeded = await refreshRooms();
        if (stopped) return;
        failures = succeeded ? 0 : failures + 1;
        schedule(failures ? Math.min(30_000, 10_000 * 2 ** Math.min(failures, 2)) : 10_000);
      })().finally(() => { task = null; });
      return task;
    };
    const onVisibility = () => {
      clearTimer();
      if (document.visibilityState === "visible") void poll();
    };
    const onOnline = () => { failures = 0; clearTimer(); void poll(); };
    const onOffline = () => clearTimer();

    void poll();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      stopped = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refreshRooms]);

  if (!PUBLIC_LOBBY_ENABLED) {
    return (
      <main className="game-shell min-h-screen px-4 py-5 sm:px-7 sm:py-8">
        <div className="mx-auto flex min-h-[calc(100vh-40px)] max-w-5xl flex-col">
          <header className="flex items-center justify-between gap-3">
            <a href="/" className="flex items-center gap-3 text-inherit no-underline">
              <div className="logo-mark"><span /><span /></div>
              <div><div className="text-lg font-black tracking-tight">同词相遇</div><div className="text-xs text-slate-500">SAME WORD</div></div>
            </a>
          </header>
          <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
            <div className="waiting-orbit"><UsersRound size={27} /></div>
            <h1 className="mt-6 text-3xl font-black tracking-tight">随机匹配大厅暂时关闭整改中</h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">我们正在完善公开房间的内容管理。私人房间仍可正常创建和游玩。</p>
            <a href="/" className="primary-btn mt-6 no-underline"><ArrowLeft size={17} />返回首页</a>
          </section>
          <footer className="py-3 text-center text-xs text-slate-400">同词相遇 · 一起联想小游戏</footer>
        </div>
      </main>
    );
  }

  async function joinRoom(room: PublicRoom) {
    setJoiningCode(room.code);
    setError("");
    try {
      const existingToken = localStorage.getItem(`${TOKEN_KEY}:${room.code}`);
      const data = await post<{ code: string; token: string }>({ action: "joinPublic", code: room.code, token: existingToken });
      enterRoom(data.code, data.token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加入失败，请重试");
      await refreshRooms();
    } finally {
      setJoiningCode("");
    }
  }

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanDescription = description.trim().replace(/\s+/g, " ");
    if (!cleanDescription) { setCreateError("写一句简单的房间介绍吧。"); return; }
    const durationSeconds = durationMode === "custom" ? customDurationSeconds : Number(durationMode);
    if (!Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 3600) {
      setCreateError("自定义时长请设为 10–3600 秒"); return;
    }

    setCreateBusy(true);
    setCreateError("");
    try {
      const data = await post<{ code: string; token: string }>({ action: "createPublic", durationSeconds, description: cleanDescription });
      enterRoom(data.code, data.token);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "创建失败，请重试");
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <main className="game-shell min-h-screen px-4 py-5 sm:px-7 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-40px)] max-w-5xl flex-col">
        <header className="flex items-center justify-between gap-3">
          <a href="/" className="flex items-center gap-3 text-inherit no-underline">
            <div className="logo-mark"><span /><span /></div>
            <div><div className="text-lg font-black tracking-tight">同词相遇</div><div className="text-xs text-slate-500">SAME WORD</div></div>
          </a>
          <button className="primary-btn min-h-11 px-4 text-sm sm:px-5" onClick={() => { setCreateError(""); setCreateOpen(true); }}>
            <Plus size={18} /><span className="hidden sm:inline">创建公开房间</span><span className="sm:hidden">开房</span>
          </button>
        </header>

        <section className="flex-1 py-8 sm:py-12">
          <a href="/" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-slate-500 no-underline hover:text-violet-700"><ArrowLeft size={17} />返回首页</a>
          <div className="mb-7 flex flex-col justify-between gap-4 sm:mb-9 sm:flex-row sm:items-end">
            <div>
              <div className="eyebrow"><UsersRound size={15} /> OPEN ROOMS</div>
              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">随机匹配大厅</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500 sm:text-base">挑一个正在等人的房间加入，也可以创建公开房间，等下一位玩家来玩。</p>
            </div>
            <button className="secondary-btn min-h-10 self-start px-4 text-sm sm:self-auto" onClick={() => void refreshRooms()} disabled={refreshing}>
              <RefreshCw className={refreshing ? "animate-spin" : ""} size={16} />刷新列表
            </button>
          </div>

          {error && <p className="error-text mb-5" role="status">{error}</p>}

          {loading ? (
            <div className="game-card flex min-h-56 items-center justify-center gap-3 p-8 text-sm font-semibold text-slate-500"><LoaderCircle className="animate-spin" size={20} />正在寻找等待中的房间…</div>
          ) : rooms.length === 0 ? (
            <div className="game-card flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
              <div className="waiting-orbit"><UsersRound size={27} /></div>
              <h2 className="mt-6 text-xl font-black">暂时还没有人在等人</h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">你可以先开一间公开房间。房间会出现在大厅里，其他玩家能看到介绍和每轮时长。</p>
              <button className="primary-btn mt-6" onClick={() => { setCreateError(""); setCreateOpen(true); }}><Plus size={18} />创建公开房间</button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2" aria-live="polite">
              {rooms.map((room) => (
                <article className="game-card flex flex-col p-5 sm:p-6" key={room.code}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold tracking-[.12em] text-slate-400">房间编号</p>
                      <p className="mt-1 font-black tracking-[.16em] text-slate-900" style={{ fontSize: "clamp(1.7rem, 5vw, 2.2rem)" }}>{room.code}</p>
                    </div>
                    <span className="pill shrink-0 text-violet-700">等待加入 · 1/2</span>
                  </div>
                  <p className="mt-4 min-h-12 break-words text-sm leading-6 text-slate-600">{room.description}</p>
                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-violet-100 pt-4">
                    <span className="feature text-sm"><Clock3 size={16} />每轮 {room.durationSeconds} 秒</span>
                    <button className="primary-btn min-h-11 px-4 text-sm" onClick={() => void joinRoom(room)} disabled={Boolean(joiningCode)}>
                      {joiningCode === room.code ? <LoaderCircle className="animate-spin" size={17} /> : <>进入房间<ArrowRight size={17} /></>}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="py-3 text-center text-xs text-slate-400">
          <div>同词相遇 · 一起联想小游戏</div>
          <div className="mt-2">
            <a href="https://afdian.com/a/hikawa00" target="_blank" rel="noreferrer" className="font-semibold text-violet-600 underline underline-offset-4 hover:text-violet-700">
              喜欢这个小游戏？支持服务器维护
            </a>
          </div>
        </footer>
      </div>

      {createOpen && <div className="preview-backdrop" role="presentation" onClick={() => !createBusy && setCreateOpen(false)}>
        <section className="preview-modal" role="dialog" aria-modal="true" aria-labelledby="create-room-title" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-4">
            <div><h2 id="create-room-title" className="text-xl font-black">创建公开房间</h2><p className="mt-1 text-sm leading-6 text-slate-500">创建后会出现在大厅，陌生玩家可以直接加入。</p></div>
            <button type="button" className="preview-close" aria-label="关闭" onClick={() => setCreateOpen(false)} disabled={createBusy}><X size={19} /></button>
          </div>
          <form className="mt-5 flex min-h-0 flex-col gap-5 overflow-y-auto" onSubmit={(event) => void createRoom(event)}>
            <label className="block text-sm font-bold text-slate-700" htmlFor="public-room-description">一句话介绍
              <input id="public-room-description" className="code-input mt-2 text-base font-medium tracking-normal" value={description} maxLength={60} onChange={(event) => setDescription(event.target.value)} placeholder="例如：来聊最近在追的番剧" />
              <span className="mt-1 block text-right text-xs font-normal text-slate-400">{description.length}/60</span>
            </label>
            <div>
              <span className="text-sm font-bold text-slate-700">每轮思考时间</span>
              <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="公开房间每轮思考时间">
                {(["30", "60", "custom"] as const).map((mode) => <button key={mode} type="button" className={`duration-option ${durationMode === mode ? "selected" : ""}`} onClick={() => setDurationMode(mode)}>{mode === "custom" ? "自定义" : `${mode} 秒`}</button>)}
              </div>
              {durationMode === "custom" && <label className="mt-3 flex items-center gap-3 text-sm font-semibold text-slate-600">每轮
                <input aria-label="自定义每轮时长（秒）" className="duration-input" type="number" min={10} max={3600} step={5} value={customDurationSeconds} onChange={(event) => setCustomDurationSeconds(Number(event.target.value))} />
                秒 <span className="text-xs font-normal text-slate-400">10–3600 秒</span>
              </label>}
            </div>
            {createError && <p className="error-text" role="alert">{createError}</p>}
            <div className="flex flex-col-reverse gap-2 border-t border-violet-100 pt-4 sm:flex-row sm:justify-end">
              <button type="button" className="secondary-btn" onClick={() => setCreateOpen(false)} disabled={createBusy}>取消</button>
              <button type="submit" className="primary-btn" disabled={createBusy || !description.trim()}>{createBusy ? <LoaderCircle className="animate-spin" size={18} /> : <Plus size={18} />}创建并进入</button>
            </div>
          </form>
        </section>
      </div>}
    </main>
  );
}
