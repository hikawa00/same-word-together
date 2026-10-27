"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Clock3, Copy, Download, Link2, LoaderCircle, Sparkles, UsersRound } from "lucide-react";

type RoomState = {
  code: string; slot: number; phase: "waiting" | "thinking" | "revealed" | "matched";
  roundNumber: number; durationSeconds: number; deadline: number | null; serverNow: number; myWord: string | null;
  mySubmitted: boolean; otherSubmitted: boolean; myReady: boolean; otherReady: boolean;
  myMatchVote: boolean; otherMatchVote: boolean; matchReason: "exact" | "manual" | null;
  words: string[] | null; history: { number: number; words: string[] }[];
};

const TOKEN_KEY = "same-word-player";

async function api(payload: Record<string, unknown>) {
  const response = await fetch("/api/game", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const data = await response.json();
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
  });

  context.textAlign = "center";
  context.fillStyle = "#817b92";
  context.font = "500 20px Arial, 'Microsoft YaHei', sans-serif";
  context.fillText("表达可以不同，只要想到的是同一个东西。", width / 2, height - 128);

  return canvas.toDataURL("image/png");
}

function saveRecordImage(image: string, code: string) {
  const link = document.createElement("a");
  link.download = `同词相遇-${code}.png`;
  link.href = image;
  link.click();
}

export default function Game() {
  const [codeInput, setCodeInput] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const [durationMode, setDurationMode] = useState<"30" | "60" | "custom">("60");
  const [customDurationSeconds, setCustomDurationSeconds] = useState(90);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"online" | "reconnecting" | "offline">("online");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlCode = (params.get("room") || "").toUpperCase();
    if (urlCode) setCodeInput(urlCode);
    const stored = urlCode ? localStorage.getItem(`${TOKEN_KEY}:${urlCode}`) : null;
    if (urlCode && stored) { setCode(urlCode); setToken(stored); }
  }, []);

  const refresh = useCallback(async () => {
    if (!code || !token) return;
    try {
      const response = await fetch(`/api/game?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "同步失败");
      setRoom(data.room); setError(""); setConnectionStatus("online");
    } catch {
      setConnectionStatus(navigator.onLine ? "reconnecting" : "offline");
    }
  }, [code, token]);

  useEffect(() => {
    refresh();
    if (!code || !token) return;
    const id = window.setInterval(refresh, 1200);
    return () => window.clearInterval(id);
  }, [code, token, refresh]);

  useEffect(() => {
    const onOnline = () => { setConnectionStatus("reconnecting"); void refresh(); };
    const onOffline = () => setConnectionStatus("offline");
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    if (!navigator.onLine) setConnectionStatus("offline");
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => { if (room && !room.mySubmitted) setWord(""); }, [room?.roundNumber]);

  const secondsLeft = useMemo(() => room?.deadline ? Math.max(0, Math.ceil((room.deadline - tick) / 1000)) : room?.durationSeconds ?? 60, [room?.deadline, room?.durationSeconds, tick]);

  function enterRoom(nextCode: string, nextToken: string) {
    localStorage.setItem(`${TOKEN_KEY}:${nextCode}`, nextToken);
    window.history.replaceState({}, "", `?room=${nextCode}`);
    setCode(nextCode); setToken(nextToken);
  }

  async function createRoom() {
    setBusy(true); setError("");
    const durationSeconds = durationMode === "custom" ? customDurationSeconds : Number(durationMode);
    if (!Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 3600) {
      setError("自定义时长请设为 10–3600 秒"); setBusy(false); return;
    }
    try { const data = await api({ action: "create", durationSeconds }); enterRoom(data.code, data.token); }
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
      const data = await api({ action: "join", code: nextCode }); enterRoom(data.code, data.token);
    } catch (err) { setError(err instanceof Error ? err.message : "加入失败"); }
    finally { setBusy(false); }
  }

  async function act(action: "submit" | "ready" | "match") {
    setBusy(true); setError("");
    try { const data = await api({ action, code, token, word }); if (data.room) setRoom(data.room); }
    catch (err) { setError(err instanceof Error ? err.message : "操作失败"); }
    finally { setBusy(false); }
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(window.location.href); setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="game-shell min-h-screen px-4 py-5 sm:px-7 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-40px)] max-w-5xl flex-col">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="logo-mark"><span /><span /></div>
            <div><div className="text-lg font-black tracking-tight">同词相遇</div><div className="text-xs text-slate-500">SAME WORD</div></div>
          </div>
          {room && <div className="pill"><UsersRound size={15} /> 房间 {room.code}</div>}
        </header>

        {!room ? (
          <section className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.15fr_.85fr]">
            <div>
              <div className="eyebrow"><UsersRound size={15} /> 词不一样？加练一轮！</div>
              <h1 className="mt-5 max-w-2xl text-4xl font-black leading-[1.04] tracking-[-.04em] text-slate-950 sm:text-5xl">你们会在第几轮<br/><span className="gradient-text">想到同一个词？</span></h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">各想一个词，同时揭晓；没撞上，就从这两个词继续联想。线上开局，不用真的跑步，发个链接就能玩。</p>
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
              <button className="primary-btn mt-4 w-full" onClick={createRoom} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" size={19}/> : <Sparkles size={19}/>} 创建房间</button>
              <div className="my-6 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200"/>或者<span className="h-px flex-1 bg-slate-200"/></div>
              <label className="text-xs font-bold uppercase tracking-[.16em] text-slate-500">房间码</label>
              <div className="mt-2 flex gap-2"><input className="code-input" value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} onKeyDown={(e) => e.key === "Enter" && joinRoom()} placeholder="A2BC8D" /><button className="icon-btn" onClick={joinRoom} disabled={busy} aria-label="加入房间"><ArrowRight size={21}/></button></div>
              {error && <p className="error-text">{error}</p>}
            </div>
          </section>
        ) : (
          <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center py-8 sm:py-12">
            {room.phase === "waiting" && <Waiting room={room} copied={copied} copyInvite={copyInvite} />}
            {room.phase === "thinking" && <Thinking room={room} secondsLeft={secondsLeft} word={word} setWord={setWord} busy={busy} submit={() => act("submit")} />}
            {(room.phase === "revealed" || room.phase === "matched") && room.words && <Reveal room={room} busy={busy} ready={() => act("ready")} match={() => act("match")} preview={() => setPreviewImage(createRecordImage(room))} restart={() => { localStorage.removeItem(`${TOKEN_KEY}:${code}`); window.location.href = "/"; }} />}
            {error && <p className="error-text mx-auto mt-4">{error}</p>}
            {connectionStatus !== "online" && <div className="connection-banner" role="status">{connectionStatus === "offline" ? "网络已断开，恢复网络后会自动重连" : "正在恢复房间连接…"}</div>}
            {room.history.length > 0 && <div className="mt-6 rounded-3xl border border-white/70 bg-white/60 p-5 backdrop-blur-sm"><div className="text-xs font-bold uppercase tracking-[.16em] text-slate-400">联想轨迹</div><div className="mt-3 flex flex-wrap gap-2">{room.history.map((item) => <div className="history-chip" key={item.number}><span>{item.number}</span>{item.words[0]} <i>×</i> {item.words[1]}</div>)}</div></div>}
          </section>
        )}
        <footer className="py-3 text-center text-xs text-slate-400">同词相遇 · 两个人的联想小游戏</footer>
        {previewImage && <div className="preview-backdrop" role="presentation" onClick={() => setPreviewImage(null)}>
          <section className="preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-title" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div><h2 id="preview-title" className="text-xl font-black">记录照片预览</h2><p className="mt-1 text-sm text-slate-500">确认版面后再保存到设备</p></div>
              <button type="button" className="preview-close" aria-label="关闭预览" onClick={() => setPreviewImage(null)}>×</button>
            </div>
            <div className="preview-image-wrap"><img src={previewImage} alt="同词相遇游戏记录照片预览" /></div>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="secondary-btn" onClick={() => setPreviewImage(null)}>返回</button>
              <button type="button" className="primary-btn" onClick={() => saveRecordImage(previewImage, room?.code ?? "记录")}><Download size={18}/> 保存照片</button>
            </div>
          </section>
        </div>}
      </div>
    </main>
  );
}

function Waiting({ room, copied, copyInvite }: { room: RoomState; copied: boolean; copyInvite: () => void }) {
  return <div className="game-card p-7 text-center sm:p-12"><div className="waiting-orbit mx-auto"><UsersRound size={29}/></div><div className="mt-6 text-xs font-bold uppercase tracking-[.18em] text-violet-600">房间已创建</div><h1 className="mt-2 text-3xl font-black sm:text-4xl">等另一位玩家加入</h1><p className="mx-auto mt-3 max-w-md text-slate-500">把链接发给朋友。对方加入后，第一轮会自动开始。</p><div className="room-code mt-8">{room.code}</div><button className="primary-btn mx-auto mt-6" onClick={copyInvite}>{copied ? <Check size={18}/> : <Copy size={18}/>} {copied ? "链接已复制" : "复制邀请链接"}</button></div>;
}

function Thinking({ room, secondsLeft, word, setWord, busy, submit }: { room: RoomState; secondsLeft: number; word: string; setWord: (v: string) => void; busy: boolean; submit: () => void }) {
  return <div className="game-card overflow-hidden"><div className="round-topbar"><span>第 {room.roundNumber} 轮</span><span className={room.durationSeconds > 0 && secondsLeft <= 10 ? "timer urgent" : "timer"}><Clock3 size={16}/>{room.durationSeconds > 0 ? `${secondsLeft}s` : "不限时"}</span></div><div className="p-6 text-center sm:p-11"><p className="text-sm font-semibold text-violet-600">根据上一轮的两个词，自由联想</p><h1 className="mt-3 text-3xl font-black sm:text-5xl">写下你脑中的那个词</h1><p className="mt-3 text-sm text-slate-500">提交后不能修改，对方在揭晓前看不到。</p>{!room.mySubmitted ? <div className="mx-auto mt-8 max-w-xl"><input autoFocus className="word-input" value={word} maxLength={32} onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => e.key === "Enter" && word.trim() && submit()} placeholder="输入一个词语…" /><button className="primary-btn mt-4 w-full" onClick={submit} disabled={busy || !word.trim()}>{busy ? <LoaderCircle className="animate-spin" size={19}/> : <Check size={19}/>} 锁定答案</button></div> : <div className="locked-answer mx-auto mt-8 max-w-xl"><span>你的答案</span><strong>{room.myWord}</strong><div className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-500">{room.otherSubmitted ? <><Check size={16}/>对方已提交，马上揭晓</> : <><LoaderCircle className="animate-spin" size={16}/>等待对方提交…</>}</div></div>}</div></div>;
}

function Reveal({ room, busy, ready, match, preview, restart }: { room: RoomState; busy: boolean; ready: () => void; match: () => void; preview: () => void; restart: () => void }) {
  const manual = room.matchReason === "manual";
  const matched = room.phase === "matched";

  return (
    <div className={matched ? "game-card win-card overflow-hidden" : "game-card overflow-hidden"}>
      <div className="round-topbar"><span>第 {room.roundNumber} 轮 · 揭晓</span><span>{matched ? "🎉 同步成功" : "还差一点"}</span></div>
      <div className="p-5 text-center sm:p-11">
        <p className="text-sm font-semibold text-violet-600">{matched ? (manual ? "你们一致认为，这是同一个意思" : "你们的脑回路终于相遇了") : "从这两个词之间，寻找下一步"}</p>
        <div className="reveal-grid mt-6 sm:mt-7">
          <div className="word-card word-a"><span>玩家 1</span><strong>{room.words?.[0]}</strong></div>
          <div className="meet-mark">×</div>
          <div className="word-card word-b"><span>玩家 2</span><strong>{room.words?.[1]}</strong></div>
        </div>
        {matched ? (
          <div className="mt-7 sm:mt-8">
            <h1 className="text-2xl font-black sm:text-4xl">{manual ? "双方确认，同词成功！" : `第 ${room.roundNumber} 轮，同词成功！`}</h1>
            <p className="mt-3 text-sm text-slate-500 sm:text-base">表达可以不同，只要你们想到的是同一个东西。</p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <button className="secondary-btn export-btn" onClick={preview}><Download size={19}/> 预览记录照片</button>
              <button className="secondary-btn restart-btn" onClick={restart}>再开一局</button>
            </div>
          </div>
        ) : (
          <div className="mt-7 sm:mt-8">
            <div className="mx-auto w-full max-w-[94%]">
              <p className="mb-4 text-left text-sm leading-6 text-slate-500">觉得两个词说的是同一个东西？双方确认也算成功。</p>
              <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
                <button className="secondary-btn sm:mx-0" onClick={match} disabled={busy || room.myMatchVote}>{room.myMatchVote ? <Check size={19}/> : <Sparkles size={19}/>} {room.myMatchVote ? "已确认，等待对方" : room.otherMatchVote ? "对方认为相同，我也同意" : "我认为意思相同"}</button>
                <button className="primary-btn" onClick={ready} disabled={busy || room.myReady}>{room.myReady ? <Check size={19}/> : <ArrowRight size={19}/>} {room.myReady ? (room.otherReady ? "正在进入下一轮" : "等对方准备好") : "继续下一轮"}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
