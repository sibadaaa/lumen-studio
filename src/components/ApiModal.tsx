import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("api");
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
      setFormError(t("errKey"));
      return null;
    }
    if (!isMock && !baseUrl.trim().startsWith("http")) {
      setFormError(t("errUrl"));
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
      toast(isMock ? t("toasts.mockOn") : t("toasts.saved"), "success");
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
    setTestMessage(t("footer.testing"));
    const saved = await save();
    if (!saved) {
      setTestState("error");
      setTestMessage(t("toasts.notSaved"));
      return;
    }
    try {
      const result = await api.testProvider(provider);
      setTestState(result.ok ? "success" : "error");
      setTestMessage(result.message);
      setLatency(result.latencyMs);
      if (result.ok) toast(t("toasts.ok"), "success");
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
            <h2 id="apiTitle">{t("title")}</h2>
            <p>{t("desc")}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label={t("close", { ns: "base" })}><X size={15} /></button>
        </header>

        <div className="modal-body">
          <div className="provider-tabs" role="tablist" aria-label={t("title")}>
            {TABS.map((item) => (
              <button key={item.id} className={provider === item.id ? "is-active" : ""} onClick={() => selectProvider(item.id)}>
                <span className={`provider-logo ${item.id}`}>{item.logo}</span>
                {t(`tabs.${item.id}` as "tabs.ark")}
                {item.tag && <em>{item.id === "ark" ? t("tabs.tagRecommend") : t("tabs.tagOffline")}</em>}
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
                  ? t("banner.offlineTitle")
                  : isMock
                    ? t("banner.mockTitle")
                    : configured
                      ? t("banner.configuredTitle")
                      : t("banner.setupTitle")}
              </strong>
              <span>
                {offline
                  ? t("banner.offlineBody")
                  : isMock
                    ? t("banner.mockBody")
                    : t("banner.configuredBody", { mask: keyMasked || "—" })}
              </span>
            </div>
            <span className="banner-tag">{offline ? "OFFLINE" : isMock ? "LOCAL" : configured ? "ENCRYPTED" : "SETUP"}</span>
          </div>

          <div className="connection-meta">
            <span><i className={runtime.online ? "ok" : ""} />{t("meta.bff", { version: runtime.version })}</span>
            <span><i className={runtime.ffmpeg ? "ok" : ""} />FFmpeg {runtime.ffmpeg ? t("meta.ffmpegOk") : t("meta.ffmpegMissing")}</span>
            <span><i className={configured ? "ok" : ""} />{configured ? t("meta.configured") : t("meta.unconfigured")}</span>
          </div>

          <div className="form-grid">
            <label className="form-field full">
              <span>{t("form.baseUrl")}</span>
              <input value={isMock ? "local://mock" : baseUrl} onChange={(event) => setBaseUrl(event.target.value)} spellCheck={false} disabled={isMock} />
            </label>
            {!isMock && (
              <label className="form-field full">
                <span>{t("form.key")} {configured && <em className="field-note">{t("form.keySaved")}</em>}</span>
                <div className="secret-input">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={configured ? t("form.keyKeep", { mask: keyMasked || "••••••••" }) : t("form.keyPlaceholder")}
                    autoComplete="new-password"
                    spellCheck={false}
                  />
                  <button type="button" onClick={() => setShowKey((prev) => !prev)}>
                    {showKey ? <EyeOff size={13} /> : <Eye size={13} />}{showKey ? t("form.hide") : t("form.show")}
                  </button>
                </div>
                <small>{t("form.keyNote")}</small>
              </label>
            )}
            <label className="form-field">
              <span>{t("form.imageModel")}</span>
              <input value={imageModel} onChange={(event) => setImageModel(event.target.value)} spellCheck={false} disabled={isMock} />
            </label>
            <label className="form-field">
              <span>{t("form.videoModel")}</span>
              <input value={videoModel} onChange={(event) => setVideoModel(event.target.value)} spellCheck={false} disabled={isMock} />
            </label>
          </div>

          {formError && <div className="form-error">{formError}</div>}

          <div className="capability-row">
            <span className="capability-label">{t("caps.label")}</span>
            {[
              [t("caps.t2i"), capabilities?.textToImage ?? true],
              [t("caps.i2i"), capabilities?.imageToImage ?? true],
              [t("caps.t2v"), capabilities?.textToVideo ?? true],
              [t("caps.i2v"), capabilities?.imageToVideo ?? true],
              [t("caps.multi"), capabilities?.multiImageToVideo ?? true],
            ].map(([label, enabled]) => (
              <span key={String(label)} className={`capability ${enabled ? "on" : ""}`}><i />{label}</span>
            ))}
            <span className={`capability ${runtime.ffmpeg ? "on" : ""}`}><i />{t("caps.ffmpeg")}</span>
          </div>

          <div className="modal-note">
            <svg viewBox="0 0 18 18" fill="none"><path d="M9 2.6 15.3 14H2.7L9 2.6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /><path d="M9 7v3.2M9 12.6v.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            <p>{t("note")}</p>
          </div>
        </div>

        <footer className="modal-foot">
          <button className={`test-btn ${testState === "testing" ? "is-testing" : ""} ${testState === "success" ? "is-success" : ""}`} onClick={() => void test()} disabled={saving || testState === "testing"}>
            <span className="test-dot" />
            {testState === "testing" ? t("footer.testing") : t("footer.test")}
          </button>
          <div className="modal-foot-right">
            <span className={`test-state ${testState === "success" ? "success" : testState === "error" ? "error" : ""}`}>
              {testState === "testing" ? (
                <><LoaderCircle size={11} className="spin" />{testMessage}</>
              ) : testMessage ? (
                <>{testMessage}{latency !== null ? ` · ${latency}ms` : ""}</>
              ) : (
                t("footer.wait")
              )}
            </span>
            <button className="save-btn" onClick={() => void handleSave()} disabled={saving}>
              {saving ? t("footer.saving") : t("footer.save")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
