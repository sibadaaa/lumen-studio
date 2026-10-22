import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, LoaderCircle, ShieldCheck, X } from "lucide-react";
import type { ProviderConfigInput, ProviderKind } from "../../shared/contracts";
import { api } from "../lib/api";
import type { StudioRuntime } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  toast: (message: string, type?: "default" | "success") => void;
  runtime: StudioRuntime;
  onRefresh: () => Promise<void>;
}

interface ProviderTab {
  id: string;
  label: string;
  kind: ProviderKind;
  tag: string;
  base: string;
  image: string;
  video: string;
  logo: string;
}

const TABS: ProviderTab[] = [
  {
    id: "ark",
    label: "火山方舟",
    kind: "ark",
    tag: "推荐",
    base: "https://ark.cn-beijing.volces.com/api/v3",
    image: "doubao-seedream-4-0-250828",
    video: "doubao-seedance-1-0-pro-250528",
    logo: "A",
  },
  {
    id: "openai",
    label: "OpenAI 兼容",
    kind: "openai_compatible",
    tag: "",
    base: "https://api.openai.com/v1",
    image: "gpt-image-1",
    video: "sora-2",
    logo: "◎",
  },
  {
    id: "custom",
    label: "自定义网关",
    kind: "openai_compatible",
    tag: "",
    base: "http://127.0.0.1:8080/v1",
    image: "custom-image-model",
    video: "custom-video-model",
    logo: "⌁",
  },
  {
    id: "mock",
    label: "本地演示",
    kind: "mock",
    tag: "离线",
    base: "local://mock",
    image: "lumen-mock-image",
    video: "lumen-mock-video",
    logo: "M",
  },
];

export function ApiModal({ open, onClose, toast, runtime, onRefresh }: Props) {
  const [provider, setProvider] = useState("ark");
  const [baseUrl, setBaseUrl] = useState(TABS[0].base);
  const [imageModel, setImageModel] = useState(TABS[0].image);
  const [videoModel, setVideoModel] = useState(TABS[0].video);
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [keyMasked, setKeyMasked] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const tab = useMemo(() => TABS.find((item) => item.id === provider) || TABS[0], [provider]);
  const isMock = tab.kind === "mock";

  const loadProvider = (id: string) => {
    const nextTab = TABS.find((item) => item.id === id) || TABS[0];
    const info = runtime.providers.find((item) => item.id === id);
    setProvider(nextTab.id);
    setBaseUrl(info?.baseUrl || nextTab.base);
    setImageModel(info?.imageModel || nextTab.image);
    setVideoModel(info?.videoModel || nextTab.video);
    setConfigured(Boolean(info?.configured));
    setKeyMasked(info?.keyMasked || "");
    setApiKey("");
    setShowKey(false);
    setTestState("idle");
    setTestMessage("");
    setLatency(info?.lastLatencyMs ?? null);
    setFormError("");
  };

  useEffect(() => {
    if (!open) return;
    loadProvider(runtime.activeProviderId || "ark");
    // Only reset the form when the modal opens or the active provider changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runtime.activeProviderId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const selectProvider = (id: string) => {
    if (saving || testState === "testing") return;
    loadProvider(id);
  };

  const save = async () => {
    if (saving) return;
    setFormError("");
    if (!isMock && !configured && !apiKey.trim()) {
      setFormError("首次配置需要填写 API Key");
      return null;
    }
    if (!isMock && !baseUrl.trim().startsWith("http")) {
      setFormError("Base URL 必须以 http:// 或 https:// 开头");
      return null;
    }
    const input: ProviderConfigInput = {
      kind: tab.kind,
      baseUrl: isMock ? "local://mock" : baseUrl.trim(),
      imageModel: isMock ? "lumen-mock-image" : imageModel.trim(),
      videoModel: isMock ? "lumen-mock-video" : videoModel.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    };
    setSaving(true);
    try {
      const info = await api.saveProvider(provider, input);
      setConfigured(info.configured);
      setKeyMasked(info.keyMasked);
      setApiKey("");
      await onRefresh();
      toast(isMock ? "本地演示引擎已启用" : "API 配置已加密保存", "success");
      return info;
    } catch (error) {
      setFormError((error as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (testState === "testing") return;
    setTestState("testing");
    setTestMessage("正在保存配置并握手…");
    const saved = await save();
    if (!saved) {
      setTestState("error");
      setTestMessage("配置未保存，无法测试");
      return;
    }
    try {
      const result = await api.testProvider(provider);
      setTestState(result.ok ? "success" : "error");
      setTestMessage(result.message);
      setLatency(result.latencyMs);
      if (result.ok) toast("连接正常，能力已同步", "success");
    } catch (error) {
      setTestState("error");
      setTestMessage((error as Error).message);
    }
  };

  const handleSave = async () => {
    const saved = await save();
    if (saved) onClose();
  };

  const capabilities = runtime.providers.find((item) => item.id === provider)?.capabilities;
  const offline = !runtime.online;

  return (
    <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="apiTitle">
        <header className="modal-head">
          <div>
            <span className="eyebrow">CONNECTION</span>
            <h2 id="apiTitle">连接生成 API</h2>
            <p>密钥只写入本机 BFF，AES-256-GCM 加密存储；前端永不保留明文。</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭"><X size={15} /></button>
        </header>

        <div className="modal-body">
          <div className="provider-tabs" role="tablist" aria-label="API 提供方">
            {TABS.map((item) => (
              <button key={item.id} className={provider === item.id ? "is-active" : ""} onClick={() => selectProvider(item.id)}>
                <span className={`provider-logo ${item.id}`}>{item.logo}</span>
                {item.label}
                {item.tag && <em>{item.tag}</em>}
              </button>
            ))}
          </div>

          <div className={`connected-banner ${offline ? "is-warning" : testState === "error" ? "is-error" : ""}`}>
            <span className="banner-icon">
              {offline ? <X size={13} /> : isMock ? <span className="mock-badge">M</span> : <ShieldCheck size={13} />}
            </span>
            <div>
              <strong>
                {offline
                  ? "本机 BFF 未启动 · 前端回退 Mock"
                  : isMock
                    ? "本地演示引擎已启用 · FFmpeg 合成"
                    : configured
                      ? "加密密钥已保存 · 等待握手"
                      : "等待配置 Provider"}
              </strong>
              <span>
                {offline
                  ? "运行 npm run dev:server 后刷新，即可启用真实上传与任务队列"
                  : isMock
                    ? "不调用外部 API；用本地素材与 FFmpeg 验证完整链路"
                    : `密钥掩码 ${keyMasked || "—"} · 存于服务端 · 文件权限 0600`}
              </span>
            </div>
            <span className="banner-tag">{offline ? "OFFLINE" : isMock ? "LOCAL" : configured ? "ENCRYPTED" : "SETUP"}</span>
          </div>

          <div className="connection-meta">
            <span><i className={runtime.online ? "ok" : ""} />BFF {runtime.online ? `v${runtime.version}` : "离线"}</span>
            <span><i className={runtime.ffmpeg ? "ok" : ""} />FFmpeg {runtime.ffmpeg ? "可用" : "未检测"}</span>
            <span><i className={configured ? "ok" : ""} />{configured ? "已配置" : "未配置"}</span>
          </div>

          <div className="form-grid">
            <label className="form-field full">
              <span>Base URL</span>
              <input value={isMock ? "local://mock" : baseUrl} onChange={(event) => setBaseUrl(event.target.value)} spellCheck={false} disabled={isMock} />
            </label>
            {!isMock && (
              <label className="form-field full">
                <span>API Key {configured && <em className="field-note">已加密保存，留空保持不变</em>}</span>
                <div className="secret-input">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={configured ? `${keyMasked || "••••••••"} · 留空保持不变` : "输入 Provider API Key"}
                    autoComplete="new-password"
                    spellCheck={false}
                  />
                  <button type="button" onClick={() => setShowKey((prev) => !prev)}>
                    {showKey ? <EyeOff size={13} /> : <Eye size={13} />}{showKey ? "隐藏" : "显示"}
                  </button>
                </div>
                <small>保存后服务端仅返回掩码；草稿不会写入 localStorage。</small>
              </label>
            )}
            <label className="form-field">
              <span>图像模型</span>
              <input value={imageModel} onChange={(event) => setImageModel(event.target.value)} spellCheck={false} disabled={isMock} />
            </label>
            <label className="form-field">
              <span>视频模型</span>
              <input value={videoModel} onChange={(event) => setVideoModel(event.target.value)} spellCheck={false} disabled={isMock} />
            </label>
          </div>

          {formError && <div className="form-error">{formError}</div>}

          <div className="capability-row">
            <span className="capability-label">能力声明</span>
            {[
              ["文生图", capabilities?.textToImage ?? true],
              ["图生图", capabilities?.imageToImage ?? true],
              ["文生视频", capabilities?.textToVideo ?? true],
              ["图生视频", capabilities?.imageToVideo ?? true],
              ["多图分镜", capabilities?.multiImageToVideo ?? true],
            ].map(([label, enabled]) => (
              <span key={String(label)} className={`capability ${enabled ? "on" : ""}`}><i />{label}</span>
            ))}
            <span className={`capability ${runtime.ffmpeg ? "on" : ""}`}><i />FFmpeg 合成</span>
          </div>

          <div className="modal-note">
            <svg viewBox="0 0 18 18" fill="none"><path d="M9 2.6 15.3 14H2.7L9 2.6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /><path d="M9 7v3.2M9 12.6v.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            <p>
              密钥经 scrypt 派生密钥后使用 AES-256-GCM 加密，落盘为 <code>v1:iv:tag:ciphertext</code>；接口与日志只返回掩码。
              本地演示模式不访问外网。若暴露到公网，请在反向代理层增加访问控制并设置 <code>APP_SECRET</code>。
            </p>
          </div>
        </div>

        <footer className="modal-foot">
          <button className={`test-btn ${testState === "testing" ? "is-testing" : ""} ${testState === "success" ? "is-success" : ""}`} onClick={() => void test()} disabled={saving || testState === "testing"}>
            <span className="test-dot" />
            {testState === "testing" ? "正在握手…" : "保存并测试"}
          </button>
          <div className="modal-foot-right">
            <span className={`test-state ${testState === "success" ? "success" : testState === "error" ? "error" : ""}`}>
              {testState === "testing" ? (
                <><LoaderCircle size={11} className="spin" />{testMessage}</>
              ) : testMessage ? (
                <>{testMessage}{latency !== null ? ` · ${latency}ms` : ""}</>
              ) : (
                "等待测试"
              )}
            </span>
            <button className="save-btn" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "保存中…" : "保存配置"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
