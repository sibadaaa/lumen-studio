import type { ProviderAdapter } from "./types.js";
import type { ResolvedProvider } from "../storage/providers.js";
import { ArkAdapter } from "./ark.js";
import { OpenAICompatibleAdapter } from "./openai.js";
import { MockAdapter } from "./mock.js";

export function createAdapter(provider: ResolvedProvider): ProviderAdapter {
  const config = {
    id: provider.id,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    imageModel: provider.imageModel,
    videoModel: provider.videoModel,
  };
  if (provider.kind === "ark") return new ArkAdapter(config);
  if (provider.kind === "mock") return new MockAdapter(config);
  return new OpenAICompatibleAdapter(config);
}
