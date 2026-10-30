"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Clock3, Copy, Download, Link2, LoaderCircle, Sparkles, UsersRound } from "lucide-react";
import { D1_BOOKMARK_HEADER, readD1Bookmark, saveD1Bookmark } from "./d1-bookmark";
import { PUBLIC_LOBBY_ENABLED } from "../lib/site-features";

type RoomState = {
  code: string; slot: number; rematch: { code: string; token: string } | null; phase: "waiting" | "thinking" | "revealed" | "matched";
  roundNumber: number; durationSeconds: number; deadline: number | null; serverNow: number; myWord: string | null;
  isPublic: boolean; description: string | null; playerCount: 2 | 3; joinedPlayerCount: number;
  mySubmitted: boolean; otherSubmittedCount: number; submittedCount: number;
  myReady: boolean; otherReadyCount: number; readyCount: number;
  myMatchVote: boolean; otherMatchVoteCount: number; matchVoteCount: number; matchReason: "exact" | "manual" | null;
  words: string[] | null; history: { number: number; words: string[] }[];
};

type RoomUpdate = Omit<RoomState, "history"> & { history?: RoomState["history"] };
type GameApiResponse = { code?: string; token?: string; room?: RoomUpdate; error?: string };

const TOKEN_KEY = "same-word-player";

function isLocalRealtimeEnabled() {
  return typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
}

async function api<T>(payload: Record<string, unknown>): Promise<T> {
  const roomCode = String(payload.code ?? "").trim().toUpperCase();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const bookmark = readD1Bookmark(roomCode);
  if (bookmark) headers[D1_BOOKMARK_HEADER] = bookmark;
  const response = await fetch("/api/game", {
    method: "POST", headers,
    body: JSON.stringify(payload),
  });
  const data = await response.json() as T & { error?: string };
  const dataWithRoom = data as typeof data & { code?: string; room?: { rematch?: { code?: string } | null } };
  saveD1Bookmark(response, [roomCode, dataWithRoom.code, dataWithRoom.room?.rematch?.code]);
  if (!response.ok) throw new Error(data.error || "出错了，请重试");
  return data;
}

function createRecordImage(room: RoomState) {
  const canvas = document.createElement("canvas");
  const rounds = [...room.history, { number: room.roundNumber, words: room.words ?? [] }];
  const width = 1080;
  const rowHeight = 176;
  const visibleRowsBeforeExtension = 4;
  const height = 515 + Math.max(rounds.length, visibleRowsBeforeExtension) * rowHeight;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#f0eaff");
  background.addColorStop(0.52, "#f9f8ff");
  background.addColorStop(1, "#e5f9fc");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const roundedRect = (x: number, y: number, w: number, h: number, radius: number, fill: string) => {
    context.beginPath();
    context.roundRect(x, y, w, h, radius);
    context.fillStyle = fill;
    context.fill();
  };

  roundedRect(58, 54, width - 116, height - 108, 40, "#ffffffd9");
  context.textAlign = "center";
  context.fillStyle = "#6d4aff";
  context.font = "700 24px Arial, 'Microsoft YaHei', sans-serif";
  context.fillText("SAME WORD · 同词相遇", width / 2, 132);
  context.fillStyle = "#171727";
  context.font = "900 56px Arial, 'Microsoft YaHei', sans-serif";
  context.fillText("你们的脑回路相遇了", width / 2, 220);
  context.fillStyle = "#77728a";
  context.font = "500 24px Arial, 'Microsoft YaHei', sans-serif";
  context.fillText(`房间 ${room.code}  ·  共 ${room.roundNumber} 轮  ·  ${new Date().toLocaleDateString("zh-CN")}`, width / 2, 274);

  rounds.forEach((round, index) => {
    const y = 330 + index * rowHeight;
    context.textAlign = "left";
    context.fillStyle = "#77728a";
    context.font = "700 21px Arial, 'Microsoft YaHei', sans-serif";
    context.fillText(`第 ${round.number} 轮`, 112, y + 26);
    if (room.playerCount === 3) {
      const positions = [82, 400, 718];
      const fills = ["#eee9ff", "#e2f8fb", "#fff1df"];
      const colors = ["#5b3dda", "#14778c", "#b56819"];
      round.words.forEach((word, playerIndex) => {
        const x = positions[playerIndex];
        roundedRect(x, y + 48, 280, 96, 22, fills[playerIndex]);
        context.textAlign = "center";
        context.fillStyle = colors[playerIndex];
        context.font = "800 30px Arial, 'Microsoft YaHei', sans-serif";
        context.fillText(word || "（未提交）", x + 140, y + 108, 250);
        if (playerIndex > 0) {
          context.fillStyle = "#a29aaf";
          context.font = "800 26px Arial, sans-serif";
          context.fillText("×", positions[playerIndex] - 20, y + 108);
        }
      });
    } else {
      roundedRect(112, y + 48, 376, 96, 22, "#eee9ff");
      roundedRect(592, y + 48, 376, 96, 22, "#e2f8fb");
      context.textAlign = "center";
      context.fillStyle = "#5b3dda";
      context.font = "800 34px Arial, 'Microsoft YaHei', sans-serif";
      context.fillText(round.words[0] || "（未提交）", 300, y + 108, 336);
      context.fillStyle = "#a29aaf";
      context.font = "800 30px Arial, sans-serif";
      context.fillText("×", width / 2, y + 108);
      context.fillStyle = "#14778c";
      context.font = "800 34px Arial, 'Microsoft YaHei', sans-serif";
      context.fillText(round.words[1] || "（未提交）", 780, y + 108, 336);
    }
  });

  context.textAlign = "center";
  context.fillStyle = "#817b92";
  context.font = "500 20px Arial, 'Microsoft YaHei', sans-serif";
  context.fillText("表达可以不同，只要想到的是同一个东西。", width / 2, height - 128);

  return canvas.toDataURL("image/png");
}

type SaveImageResult = "shared" | "downloaded" | "cancelled";

function imageDataUrlToBlob(image: string) {
  const [metadata, encoded] = image.split(",", 2);
  if (!metadata || !encoded) throw new Error("照片数据无效");
  const mimeType = metadata.match(/^data:(.*?);base64$/)?.[1] || "image/png";
  const binary = window.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

async function saveRecordImage(image: string, code: string): Promise<SaveImageResult> {
  const fileName = `同词相遇-${code}.png`;
  const blob = imageDataUrlToBlob(image);
  const mobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const shareApi = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title: string }) => Promise<void>;
  };

  if (mobileDevice && typeof File !== "undefined" && shareApi.canShare && shareApi.share) {
    try {
      const file = new File([blob], fileName, { type: blob.type || "image/png" });
      const shareData = { files: [file], title: "同词相遇游戏记录" };
      if (shareApi.canShare(shareData)) {
        try {
          await shareApi.share(shareData);
          return "shared";
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return "cancelled";
        }
      }
    } catch {
      // Continue to the download fallback if file sharing is unavailable.
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.style.position = "fixed";
  link.style.left = "-9999px";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
  return "downloaded";
}

export default function Game() {
  const [codeInput, setCodeInput] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<"submit" | "ready" | "match" | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyFailedUrl, setCopyFailedUrl] = useState("");
  const [tick, setTick] = useState(Date.now());
  const [durationMode, setDurationMode] = useState<"30" | "60" | "custom">("60");
  const [customDurationSeconds, setCustomDurationSeconds] = useState(90);
  const [playerCount, setPlayerCount] = useState<2 | 3>(2);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<"online" | "reconnecting" | "offline">("online");
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const autoSubmittedRoundRef = useRef<number | null>(null);
  const roomRef = useRef<RoomState | null>(null);
  const applyRoom = useCallback((next: RoomUpdate) => {
    const previous = roomRef.current;
    const updated = {
      ...next,
      history: next.history ?? (previous?.code === next.code ? previous.history : []),
    };
    roomRef.current = updated;
    setRoom(updated);
  }, []);
  const enterRoom = useCallback((nextCode: string, nextToken: string) => {
    localStorage.setItem(`${TOKEN_KEY}:${nextCode}`, nextToken);
    window.history.replaceState({}, "", `?room=${nextCode}`);
    roomRef.current = null;
    setRoom(null);
    setError("");
    setConnectionStatus("online");
    setCode(nextCode);
    setToken(nextToken);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlCode = (params.get("room") || "").toUpperCase();
    if (urlCode) setCodeInput(urlCode);
    const stored = urlCode ? localStorage.getItem(`${TOKEN_KEY}:${urlCode}`) : null;
    if (urlCode && stored) { setCode(urlCode); setToken(stored); }
  }, []);

  const refresh = useCallback(async () => {
    if (!code || !token) return false;
    try {
      const params = new URLSearchParams({ code, token, compact: "1" });
      const knownRoom = roomRef.current;
      if (knownRoom?.code === code) params.set("knownRound", String(knownRoom.roundNumber));
      else params.set("history", "1");
      const headers: Record<string, string> = {};
      const bookmark = readD1Bookmark(code);
      if (bookmark) headers[D1_BOOKMARK_HEADER] = bookmark;
      const response = await fetch("/api/game?" + params.toString(), { cache: "no-store", headers });
      const data = await response.json() as GameApiResponse;
      saveD1Bookmark(response, [code, data.room?.rematch?.code]);
      if (!response.ok) throw new Error(data.error || "同步失败");
      if (!data.room) throw new Error("同步失败，请重试");
      if (data.room.rematch) {
        enterRoom(data.room.rematch.code, data.room.rematch.token);
        return true;
      }
      applyRoom(data.room); setError(""); setConnectionStatus("online");
      return true;
    } catch {
      setConnectionStatus(navigator.onLine ? "reconnecting" : "offline");
      return false;
    }
  }, [code, token, enterRoom, applyRoom]);

  useEffect(() => {
    if (!code || !token) return;
    let realtimeEnabled = isLocalRealtimeEnabled();
    let timer: number | undefined;
    let reconnectTimer: number | undefined;
    let stopped = false;
    let failures = 0;
    let reconnectDelay = 1000;
    let socket: WebSocket | null = null;
    let socketConnected = false;
    let pollTask: Promise<void> | null = null;

    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const schedule = (delay: number) => {
      clearTimer();
      if (stopped || document.visibilityState !== "visible" || !navigator.onLine) return;
      let nextDelay = delay;
      if (socketConnected) {
        const deadline = roomRef.current?.deadline;
        const untilDeadline = deadline !== null && deadline !== undefined && deadline > Date.now()
          ? deadline - Date.now() + 150
          : Number.POSITIVE_INFINITY;
        // Keep a slow safety check, and still refresh exactly when a round expires.
        nextDelay = Math.min(60_000, untilDeadline);
      }
      timer = window.setTimeout(() => { timer = undefined; void poll(); }, Math.max(200, nextDelay));
    };
    const poll = (): Promise<void> => {
      if (pollTask) return pollTask;
      if (stopped || document.visibilityState !== "visible") return Promise.resolve();
      pollTask = (async () => {
        if (!navigator.onLine) {
          setConnectionStatus("offline");
          return;
        }
        const succeeded = await refresh();
        if (stopped) return;
        failures = succeeded ? 0 : failures + 1;
        const currentRoom = roomRef.current;
        const remainingMs = currentRoom?.deadline == null ? null : currentRoom.deadline - Date.now();
        const needsFastSync = currentRoom?.code === code && (
          currentRoom.mySubmitted || currentRoom.myReady || currentRoom.myMatchVote ||
          currentRoom.phase === "revealed" || currentRoom.phase === "matched" ||
          (remainingMs !== null && remainingMs <= 15_000)
        );
        const delay = succeeded
          ? (needsFastSync ? 3000 + Math.floor(Math.random() * 500) : 5000 + Math.floor(Math.random() * 1000))
          : Math.min(30000, 3000 * 2 ** Math.min(failures, 4));
        schedule(delay);
      })().finally(() => { pollTask = null; });
      return pollTask;
    };
    const connectSocket = () => {
      if (!realtimeEnabled || stopped || !navigator.onLine || document.visibilityState !== "visible") return;
      if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;
      const socketUrl = new URL("/api/game/socket", window.location.href);
      socketUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socketUrl.searchParams.set("code", code);
      socketUrl.searchParams.set("token", token);
      const nextSocket = new WebSocket(socketUrl);
      socket = nextSocket;
      nextSocket.onopen = () => {
        if (stopped || socket !== nextSocket) return;
        socketConnected = true;
        reconnectDelay = 1000;
        failures = 0;
        setRealtimeConnected(true);
        clearTimer();
        void poll();
      };
      nextSocket.onmessage = (event) => {
        if (socket !== nextSocket) return;
        try {
          const message = JSON.parse(String(event.data)) as { type?: string };
          if (message.type === "changed") void poll();
        } catch {
          // Ignore malformed prototype messages and let the normal refresh recover.
        }
      };
      nextSocket.onclose = () => {
        if (socket !== nextSocket) return;
        socket = null;
        socketConnected = false;
        setRealtimeConnected(false);
        if (stopped || !navigator.onLine) return;
        setConnectionStatus("reconnecting");
        schedule(1500);
        const wait = reconnectDelay;
        reconnectDelay = Math.min(30_000, reconnectDelay * 2);
        reconnectTimer = window.setTimeout(connectSocket, wait);
      };
      nextSocket.onerror = () => nextSocket.close();
    };
    const onVisibility = () => {
      clearTimer();
      if (document.visibilityState === "visible") {
        connectSocket();
        void poll();
      }
    };
    const onOnline = () => {
      failures = 0;
      setConnectionStatus("reconnecting");
      clearTimer();
      connectSocket();
      void poll();
    };
    const onOffline = () => {
      clearTimer();
      setConnectionStatus("offline");
      socket?.close();
    };

    void poll();
    if (realtimeEnabled) {
      connectSocket();
    } else {
      void fetch(`/api/game/realtime-config?code=${encodeURIComponent(code)}`, { cache: "no-store" })
        .then(async (response) => response.ok ? response.json() as Promise<{ enabled?: boolean }> : { enabled: false })
        .then((config) => {
          if (stopped || config.enabled !== true) return;
          realtimeEnabled = true;
          connectSocket();
        })
        .catch(() => {
          // Realtime is optional; keep the existing polling path if config lookup fails.
        });
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimer();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close(1000, "room changed");
      setRealtimeConnected(false);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [code, token, refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => { if (room && !room.mySubmitted) setWord(""); }, [room?.roundNumber]);

  const secondsLeft = useMemo(() => room?.deadline ? Math.max(0, Math.ceil((room.deadline - tick) / 1000)) : room?.durationSeconds ?? 60, [room?.deadline, room?.durationSeconds, tick]);



  async function createRoom() {
    setBusy(true); setError("");
    const durationSeconds = durationMode === "custom" ? customDurationSeconds : Number(durationMode);
    if (!Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 3600) {
      setError("自定义时长请设为 10–3600 秒"); setBusy(false); return;
    }
    try { const data = await api<{ code: string; token: string }>({ action: "create", durationSeconds, playerCount }); enterRoom(data.code, data.token); }
    catch (err) { setError(err instanceof Error ? err.message : "创建失败"); }
    finally { setBusy(false); }
  }

  async function joinRoom() {
    const nextCode = codeInput.trim().toUpperCase();
    if (nextCode.length !== 6) { setError("请输入 6 位房间码"); return; }
    setBusy(true); setError("");
    try {
      const stored = localStorage.getItem(`${TOKEN_KEY}:${nextCode}`);
      if (stored) { enterRoom(nextCode, stored); return; }
      const data = await api<{ code: string; token: string }>({ action: "join", code: nextCode }); enterRoom(data.code, data.token);
    } catch (err) { setError(err instanceof Error ? err.message : "加入失败"); }
    finally { setBusy(false); }
  }

  const act = useCallback(async (action: "submit" | "ready" | "match", options?: { autoSubmit?: boolean }) => {
    setBusy(true); setPendingAction(action); setError("");
    try {
      const knownRound = roomRef.current?.code === code ? roomRef.current.roundNumber : undefined;
      const data = await api<GameApiResponse>({ action, code, token, word, compact: true, knownRound, ...(options?.autoSubmit ? { autoSubmit: true } : {}) });
      if (data.room?.rematch) enterRoom(data.room.rematch.code, data.room.rematch.token);
      else if (data.room) applyRoom(data.room);
    } catch (err) { setError(err instanceof Error ? err.message : "操作失败"); }
    finally { setBusy(false); setPendingAction(null); }
  }, [code, token, word, enterRoom, applyRoom]);

  useEffect(() => {
    if (!room || room.mySubmitted || !word.trim() || !room.deadline || secondsLeft > 0) return;
    if (room.phase !== "thinking" && room.phase !== "revealed") return;
    if (busy || autoSubmittedRoundRef.current === room.roundNumber) return;

    autoSubmittedRoundRef.current = room.roundNumber;
    void act("submit", { autoSubmit: true });
  }, [act, busy, room, secondsLeft, word]);

  async function handleSaveRecordImage() {
    if (!previewImage) return;
    setSaveFeedback("");
    try {
      const result = await saveRecordImage(previewImage, room?.code ?? "记录");
      if (result === "shared") {
        setSaveFeedback("已打开手机分享菜单，可选择保存到照片或文件。");
      } else if (result === "cancelled") {
        setSaveFeedback("已取消分享；也可以长按上方照片保存。");
      } else {
        setSaveFeedback("若没有出现下载，可长按上方照片，选择保存图片。");
      }
    } catch {
      setSaveFeedback("浏览器未能直接保存，请长按上方照片，选择保存图片。");
    }
  }

  async function copyInvite() {
    const inviteUrl = window.location.href;
    let success = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl);
        success = true;
      }
    } catch {
      // Fall back for mobile browsers that deny Clipboard API access.
    }

    if (!success) {
      const input = document.createElement("textarea");
      input.value = inviteUrl;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.left = "0";
      input.style.top = "0";
      input.style.opacity = "0";
      input.style.fontSize = "16px";
      document.body.appendChild(input);
      input.focus();
      input.select();
      input.setSelectionRange(0, input.value.length);
      try {
        success = document.execCommand("copy");
      } catch {
        success = false;
      }
      input.remove();
    }

    if (success) {
      setCopied(true);
      setCopyFailedUrl("");
      window.setTimeout(() => setCopied(false), 1800);
    } else {
      setCopied(false);
      setCopyFailedUrl(inviteUrl);
    }
  }

  return (
    <main className="game-shell min-h-screen px-4 py-5 sm:px-7 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-40px)] max-w-5xl flex-col">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="logo-mark"><span /><span /></div>
            <div><div className="text-lg font-black tracking-tight">同词相遇</div><div className="text-xs text-slate-500">SAME WORD</div></div>
          </div>
          {room && <div className="flex items-center gap-2"><div className="pill"><UsersRound size={15} /> 房间 {room.code}</div>{realtimeConnected && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">实时连接</span>}</div>}
        </header>

        {!room ? (
          code && token ? (
            <section className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-8 sm:py-12">
              <div className="game-card p-7 text-center sm:p-12">
                <div className="waiting-orbit mx-auto"><LoaderCircle size={29} className="animate-spin"/></div>
                <h1 className="mt-6 text-2xl font-black sm:text-3xl">
                  {connectionStatus === "offline" ? "网络已断开" : connectionStatus === "reconnecting" ? "正在重新连接房间…" : "正在进入房间…"}
                </h1>
                <p className="mx-auto mt-3 max-w-md text-slate-500">
                  房间号 <strong className="text-slate-700">{code}</strong>
                  {connectionStatus === "offline" ? "。恢复网络后会自动重试。" : connectionStatus === "reconnecting" ? "。连接恢复后会自动进入等待或游戏界面。" : "。正在同步房间状态，请稍候。"}
                </p>
              </div>
            </section>
          ) : (
          <section className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.15fr_.85fr]">
            <div>
              <div className="eyebrow"><UsersRound size={15} /> 词不一样？加练一轮！</div>
              <h1 className="mt-5 max-w-2xl text-4xl font-black leading-[1.04] tracking-[-.04em] text-slate-950 sm:text-5xl">你们会在第几轮<br/><span className="gradient-text">想到同一个词？</span></h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">各想一个词，同时揭晓；没撞上，就从这些词继续联想。线上开局，不用真的跑步，发个链接就能玩。</p>
              <div className="mt-8 flex flex-wrap gap-3 text-sm text-slate-600"><span className="feature"><Clock3 size={16}/> 30 / 60 秒或自定义</span><span className="feature"><Link2 size={16}/> 链接邀请好友</span><span className="feature"><Sparkles size={16}/> 同词即通关</span></div>
            </div>
            <div className="game-card p-6 sm:p-8">
              <h2 className="text-2xl font-black">开始一局</h2><p className="mt-2 text-sm text-slate-500">创建新房间，或输入朋友发来的房间码。</p>
              <label className="mt-7 block text-xs font-bold uppercase tracking-[.16em] text-slate-500">每轮思考时间</label>
              <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="每轮思考时间">
                {(["30", "60", "custom"] as const).map((mode) => <button key={mode} type="button" className={`duration-option ${durationMode === mode ? "selected" : ""}`} onClick={() => setDurationMode(mode)}>{mode === "custom" ? "自定义" : `${mode} 秒`}</button>)}
              </div>
              {durationMode === "custom" && <label className="mt-3 flex items-center gap-3 text-sm font-semibold text-slate-600">每轮
                <input aria-label="自定义每轮时长（秒）" className="duration-input" type="number" min={10} max={3600} step={5} value={customDurationSeconds} onChange={(event) => setCustomDurationSeconds(Number(event.target.value))} />
                秒 <span className="text-xs font-normal text-slate-400">10–3600 秒</span>
              </label>}
              <label className="mt-6 block text-xs font-bold uppercase tracking-[.16em] text-slate-500">私人房间人数</label>
              <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="私人房间人数">
                {([2, 3] as const).map((count) => <button key={count} type="button" className={`duration-option ${playerCount === count ? "selected" : ""}`} onClick={() => setPlayerCount(count)}>{count} 人</button>)}
              </div>
              {playerCount === 3 && <p className="mt-2 text-xs text-slate-500">三位玩家都加入后，第一轮才会开始。</p>}
              <button className="primary-btn mt-4 w-full" onClick={createRoom} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" size={19}/> : <Sparkles size={19}/>} 创建房间</button>
              <div className="my-6 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200"/>或者<span className="h-px flex-1 bg-slate-200"/></div>
              <label className="text-xs font-bold uppercase tracking-[.16em] text-slate-500">房间码</label>
              <div className="mt-2 flex gap-2"><input className="code-input" value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} onKeyDown={(e) => e.key === "Enter" && joinRoom()} placeholder="A2BC8D" /><button className="icon-btn" onClick={joinRoom} disabled={busy} aria-label="加入房间"><ArrowRight size={21}/></button></div>
              {PUBLIC_LOBBY_ENABLED ? (
                <a className="secondary-btn mt-3 w-full no-underline" href="/lobby"><UsersRound size={18}/>不想等？来随机匹配<ArrowRight size={17}/></a>
              ) : (
                <div className="secondary-btn mt-3 w-full cursor-not-allowed opacity-60" aria-disabled="true"><UsersRound size={18}/>随机匹配大厅暂时关闭整改中</div>
              )}
              {error && <p className="error-text">{error}</p>}
            </div>
          </section>
          )
        ) : (
          <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center py-8 sm:py-12">
            {room.phase === "waiting" && <Waiting room={room} copied={copied} copyInvite={copyInvite} copyFailedUrl={copyFailedUrl} />}
            {room.phase === "thinking" && <Thinking room={room} secondsLeft={secondsLeft} word={word} setWord={setWord} busy={busy} submit={() => act("submit")} />}
            {(room.phase === "revealed" || room.phase === "matched") && room.words && <Reveal room={room} busy={busy} pendingAction={pendingAction} ready={() => act("ready")} match={() => act("match")} preview={() => setPreviewImage(createRecordImage(room))} restart={() => { localStorage.removeItem(`${TOKEN_KEY}:${code}`); window.location.href = "/"; }} />}
            {error && <p className="error-text mx-auto mt-4">{error}</p>}
            {connectionStatus !== "online" && <div className="connection-banner" role="status">{connectionStatus === "offline" ? "网络已断开，恢复网络后会自动重连" : "正在恢复房间连接…"}</div>}
            {room.history.length > 0 && <div className="mt-6 rounded-3xl border border-white/70 bg-white/60 p-5 backdrop-blur-sm"><div className="text-xs font-bold uppercase tracking-[.16em] text-slate-400">联想轨迹</div><div className="mt-3 flex flex-wrap gap-2">{room.history.map((item) => <div className="history-chip" key={item.number}><span>{item.number}</span>{item.words.map((entry, index) => <Fragment key={index}>{index > 0 && <i>×</i>}{entry}</Fragment>)}</div>)}</div></div>}
          </section>
        )}
        <footer className="py-4 text-center text-xs text-slate-400">
          <div>同词相遇 · 一起联想小游戏</div>
          {!code && <div className="mt-2">
            <a href="https://afdian.com/a/hikawa00" target="_blank" rel="noreferrer" className="font-semibold text-violet-600 underline underline-offset-4 hover:text-violet-700">
              喜欢这个小游戏？支持服务器维护
            </a>
          </div>}
        </footer>
        {previewImage && <div className="preview-backdrop" role="presentation" onClick={() => setPreviewImage(null)}>
          <section className="preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-title" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div><h2 id="preview-title" className="text-xl font-black">记录照片预览</h2><p className="mt-1 text-sm text-slate-500">确认版面后再保存到设备</p></div>
              <button type="button" className="preview-close" aria-label="关闭预览" onClick={() => setPreviewImage(null)}>×</button>
            </div>
            <div className="preview-image-wrap"><img src={previewImage} alt="同词相遇游戏记录照片预览" /></div>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="secondary-btn" onClick={() => setPreviewImage(null)}>返回</button>
              <button type="button" className="primary-btn" onClick={() => void handleSaveRecordImage()}><Download size={18}/> 保存照片</button>
            </div>
            {saveFeedback && <p className="mt-3 text-center text-sm text-slate-500" role="status">{saveFeedback}</p>}
          </section>
        </div>}
      </div>
    </main>
  );
}

function Waiting({ room, copied, copyInvite, copyFailedUrl }: { room: RoomState; copied: boolean; copyInvite: () => void; copyFailedUrl: string }) {
  return <div className="game-card p-7 text-center sm:p-12"><div className="waiting-orbit mx-auto"><UsersRound size={29}/></div><div className="mt-6 text-xs font-bold uppercase tracking-[.18em] text-violet-600">{room.isPublic ? "随机匹配大厅 · 公开房间" : `私人房间 · ${room.playerCount} 人`}</div><h1 className="mt-2 text-3xl font-black sm:text-4xl">等其他玩家加入</h1><p className="mx-auto mt-3 max-w-md text-slate-500">{room.isPublic ? "房间正在大厅等待陌生玩家加入。" : `已有 ${room.joinedPlayerCount}/${room.playerCount} 人加入，把邀请链接发给${room.playerCount === 3 ? "另外两位朋友" : "朋友"}；人齐后第一轮自动开始。`}</p>{room.isPublic && room.description && <p className="mx-auto mt-4 max-w-lg rounded-2xl bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-700">{room.description}</p>}<div className="room-code mt-8">{room.code}</div><button className="primary-btn mx-auto mt-6" onClick={copyInvite}>{copied ? <Check size={18}/> : <Copy size={18}/>} {copied ? "链接已复制" : "复制邀请链接"}</button>{copyFailedUrl && <div className="mx-auto mt-4 max-w-lg text-left"><p className="text-sm text-slate-500">浏览器未能自动复制，请长按下方链接手动复制。</p><input aria-label="邀请链接" dir="ltr" readOnly value={copyFailedUrl} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600" /></div>}</div>;
}

function Thinking({ room, secondsLeft, word, setWord, busy, submit }: { room: RoomState; secondsLeft: number; word: string; setWord: (v: string) => void; busy: boolean; submit: () => void }) {
  return <div className="game-card overflow-hidden"><div className="round-topbar"><span>第 {room.roundNumber} 轮</span><span className={room.durationSeconds > 0 && secondsLeft <= 10 ? "timer urgent" : "timer"}><Clock3 size={16}/>{room.durationSeconds > 0 ? `${secondsLeft}s` : "不限时"}</span></div><div className="p-6 text-center sm:p-11"><p className="text-sm font-semibold text-violet-600">根据上一轮的词语，自由联想</p><h1 className="mt-3 text-3xl font-black sm:text-5xl">写下你脑中的那个词</h1><p className="mt-3 text-sm text-slate-500">提交后不能修改，其他玩家在揭晓前看不到。</p>{!room.mySubmitted ? <div className="mx-auto mt-8 max-w-xl"><input autoFocus className="word-input" value={word} maxLength={32} onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => e.key === "Enter" && word.trim() && submit()} placeholder="输入一个词语…" /><button className="primary-btn mt-4 w-full" onClick={submit} disabled={busy || !word.trim()}>{busy ? <LoaderCircle className="animate-spin" size={19}/> : <Check size={19}/>} {busy ? "正在提交答案…" : "锁定答案"}</button></div> : <div className="locked-answer mx-auto mt-8 max-w-xl"><span>你的答案</span><strong>{room.myWord}</strong><div className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-500">{room.otherSubmittedCount === room.playerCount - 1 ? <><Check size={16}/>其他玩家已提交，马上揭晓</> : <><LoaderCircle className="animate-spin" size={16}/>等待其他玩家提交（{room.otherSubmittedCount}/{room.playerCount - 1}）…</>}</div></div>}</div></div>;
}

function Reveal({ room, busy, pendingAction, ready, match, preview, restart }: { room: RoomState; busy: boolean; pendingAction: "submit" | "ready" | "match" | null; ready: () => void; match: () => void; preview: () => void; restart: () => void }) {
  const manual = room.matchReason === "manual";
  const matched = room.phase === "matched";

  return (
    <div className={matched ? "game-card win-card overflow-hidden" : "game-card overflow-hidden"}>
      <div className="round-topbar"><span>第 {room.roundNumber} 轮 · 揭晓</span><span>{matched ? "🎉 同步成功" : "还差一点"}</span></div>
      <div className="p-5 text-center sm:p-11">
        <p className="text-sm font-semibold text-violet-600">{matched ? (manual ? "你们一致认为，这是同一个意思" : "你们的脑回路终于相遇了") : "从这两个词之间，寻找下一步"}</p>
        <div className={`reveal-grid ${room.playerCount === 3 ? "reveal-grid-three" : ""} mt-6 sm:mt-7`}>
          {room.words?.map((word, index) => <div className="reveal-player" key={index}>
            {index > 0 && <div className="meet-mark">×</div>}
            <div className={`word-card ${["word-a", "word-b", "word-c"][index]}`}><span>玩家 {index + 1}</span><strong>{word}</strong></div>
          </div>)}
        </div>
        {matched ? (
          <div className="mt-7 sm:mt-8">
            <h1 className="text-2xl font-black sm:text-4xl">{manual ? `${room.playerCount === 3 ? "三位" : "双方"}确认，同词成功！` : `第 ${room.roundNumber} 轮，同词成功！`}</h1>
            <p className="mt-3 text-sm text-slate-500 sm:text-base">表达可以不同，只要你们想到的是同一个东西。</p>
            <p className="mt-2 text-sm text-slate-500">{room.playerCount === 3 ? "三位玩家都同意后" : "双方都同意后"}会自动进入新的房间，上一局记录会保留。</p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <button className="secondary-btn export-btn" onClick={preview}><Download size={19}/> 预览记录照片</button>
              <div className="flex flex-col items-center gap-1">
                <button className="primary-btn" onClick={ready} disabled={busy || room.myReady}>
                  {pendingAction === "ready" ? <LoaderCircle className="animate-spin" size={19}/> : room.myReady ? <Check size={19}/> : <ArrowRight size={19}/>}
                  {pendingAction === "ready" ? "正在进入新房间…" : room.myReady
                    ? room.readyCount === room.playerCount ? "正在进入新房间…" : `已同意，等其他人（${room.readyCount}/${room.playerCount}）`
                    : `再玩一局${room.readyCount > 0 ? `（${room.readyCount}/${room.playerCount}）` : ""}`}
                </button>
                <a href="https://afdian.com/a/hikawa00" target="_blank" rel="noreferrer" className="mt-1 text-xs text-violet-600 underline underline-offset-4 hover:text-violet-700">
                  喜欢这个小游戏？支持服务器维护
                </a>
              </div>
              <button className="secondary-btn restart-btn" onClick={restart}>结束并返回首页</button>
            </div>
          </div>
        ) : (
          <div className="mt-7 sm:mt-8">
            <div className="mx-auto w-full max-w-[94%]">
              <p className="mb-4 text-left text-sm leading-6 text-slate-500">觉得这些词说的是同一个东西？{room.playerCount === 3 ? "三位玩家确认" : "双方确认"}也算成功。</p>
              <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
                <button className="secondary-btn sm:mx-0" onClick={match} disabled={busy || room.myMatchVote}>{pendingAction === "match" ? <LoaderCircle className="animate-spin" size={19}/> : room.myMatchVote ? <Check size={19}/> : <Sparkles size={19}/>} {pendingAction === "match" ? "正在确认…" : room.myMatchVote ? `已确认，等其他人（${room.matchVoteCount}/${room.playerCount}）` : room.otherMatchVoteCount > 0 ? `已有 ${room.otherMatchVoteCount} 位认为相同，我也同意` : "我认为意思相同"}</button>
                <button className="primary-btn" onClick={ready} disabled={busy || room.myReady}>{pendingAction === "ready" ? <LoaderCircle className="animate-spin" size={19}/> : room.myReady ? <Check size={19}/> : <ArrowRight size={19}/>} {pendingAction === "ready" ? "正在进入下一轮…" : room.myReady ? (room.readyCount === room.playerCount ? "正在进入下一轮" : `等其他人准备（${room.readyCount}/${room.playerCount}）`) : `继续下一轮${room.readyCount > 0 ? `（${room.readyCount}/${room.playerCount}）` : ""}`}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
