"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  getLlmSettings,
  updateLlmSettings,
  type LlmReferenceSetting,
} from "@/lib/client-api";
import { SettingsSidebar } from "@/components/settings-sidebar";
import { SuperAdminBanner } from "@/components/super-admin-banner";

type EditableReference = {
  referenceKind: "link" | "document";
  title: string;
  referenceValue: string;
  usageNote: string;
};

function buildLoginRedirect(nextPath: string) {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}

export default function LlmSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [llmSystemPrompt, setLlmSystemPrompt] = useState("");
  const [llmMasterPrompt, setLlmMasterPrompt] = useState<string | null>(null);
  const [llmReferences, setLlmReferences] = useState<EditableReference[]>([]);
  const [llmManageable, setLlmManageable] = useState(true);
  const [llmSaving, setLlmSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const llmData = await getLlmSettings();
        if (!mounted) {
          return;
        }
        setLlmSystemPrompt(llmData.systemPrompt ?? "");
        setLlmMasterPrompt(llmData.masterPrompt);
        setLlmManageable(llmData.manageable);
        setLlmReferences(
          llmData.references.map((reference: LlmReferenceSetting) => ({
            referenceKind: reference.referenceKind,
            title: reference.title,
            referenceValue: reference.referenceValue,
            usageNote: reference.usageNote,
          })),
        );
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace(buildLoginRedirect("/app/llm-settings"));
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load LLM settings");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [router]);

  function updateReference<K extends keyof EditableReference>(index: number, key: K, value: EditableReference[K]) {
    setLlmReferences((current) =>
      current.map((reference, currentIndex) =>
        currentIndex === index ? { ...reference, [key]: value } : reference,
      ),
    );
  }

  function addReference() {
    setLlmReferences((current) => [
      ...current,
      {
        referenceKind: "link",
        title: "",
        referenceValue: "",
        usageNote: "",
      },
    ]);
  }

  function removeReference(index: number) {
    setLlmReferences((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function onSaveLlmSettings() {
    setLlmSaving(true);
    setError(null);
    setMessage(null);
    try {
      await updateLlmSettings({
        systemPrompt: llmSystemPrompt,
        references: llmReferences.map((reference, index) => ({
          referenceKind: reference.referenceKind,
          title: reference.title,
          referenceValue: reference.referenceValue,
          usageNote: reference.usageNote,
          sortOrder: index,
        })),
      });
      setMessage("LLM settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save LLM settings");
    } finally {
      setLlmSaving(false);
    }
  }

  return (
    <main className="mx-auto h-screen w-full max-w-[1400px] overflow-hidden px-6 py-8">
      <div className="flex h-full min-h-0 flex-col gap-4">
        <SuperAdminBanner />
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <SettingsSidebar active="llm-settings" className="h-full min-h-0 overflow-y-auto" />
          <section className="calm-card h-full min-h-0 overflow-y-auto p-6 md:p-8">
            <h1 className="text-2xl font-semibold tracking-tight text-[#331c4a]">LLM Settings</h1>
            <p className="mt-2 text-sm text-[#6b5588]">
              Customize your personal prompt and reference guidance for generation.
            </p>

            {loading ? <p className="mt-4 text-sm text-[#70598f]">Loading LLM settings...</p> : null}
            {error ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            {message ? (
              <p className="mt-4 rounded-xl border border-[#d9cce8] bg-[#f8f3fd] px-3 py-2 text-sm text-[#543673]">{message}</p>
            ) : null}

            <div className="mt-6 rounded-xl border border-[var(--border)] bg-white p-4">
              {llmMasterPrompt ? (
                <div className="rounded-lg border border-[var(--border)] bg-[#fcf9ff] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#7a6298]">Current Master Prompt</p>
                  <p className="mt-2 whitespace-pre-wrap text-xs text-[#48666c]">{llmMasterPrompt}</p>
                </div>
              ) : null}

              <label className="mt-3 block text-xs font-semibold uppercase tracking-wider text-[#7a6298]">Your System Prompt</label>
              <textarea
                value={llmSystemPrompt}
                onChange={(event) => setLlmSystemPrompt(event.target.value)}
                className="calm-input mt-2 min-h-28 w-full px-3 py-2 text-sm"
                placeholder="Add your personal writing instructions..."
                disabled={!llmManageable || llmSaving}
              />

              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#7a6298]">Reference Guidance</p>
                <p className="mt-1 text-xs text-[#6d578c]">
                  Add links/documents and note when the LLM should use each source.
                </p>
                <div className="mt-2 space-y-3">
                  {llmReferences.map((reference, index) => (
                    <div key={index} className="rounded-lg border border-[var(--border)] bg-[#fcf9ff] p-3">
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-[140px_1fr]">
                        <select
                          value={reference.referenceKind}
                          onChange={(event) => updateReference(index, "referenceKind", event.target.value as "link" | "document")}
                          className="calm-input px-3 py-2 text-sm"
                          disabled={!llmManageable || llmSaving}
                        >
                          <option value="link">Link</option>
                          <option value="document">Document</option>
                        </select>
                        <input
                          value={reference.title}
                          onChange={(event) => updateReference(index, "title", event.target.value)}
                          className="calm-input px-3 py-2 text-sm"
                          placeholder="Reference title"
                          disabled={!llmManageable || llmSaving}
                        />
                      </div>
                      <input
                        value={reference.referenceValue}
                        onChange={(event) => updateReference(index, "referenceValue", event.target.value)}
                        className="calm-input mt-2 w-full px-3 py-2 text-sm"
                        placeholder={reference.referenceKind === "link" ? "https://..." : "Document name or identifier"}
                        disabled={!llmManageable || llmSaving}
                      />
                      <textarea
                        value={reference.usageNote}
                        onChange={(event) => updateReference(index, "usageNote", event.target.value)}
                        className="calm-input mt-2 min-h-20 w-full px-3 py-2 text-sm"
                        placeholder="When should the LLM use this reference?"
                        disabled={!llmManageable || llmSaving}
                      />
                      <button
                        type="button"
                        className="mt-2 text-xs text-[#b34b4b] hover:underline"
                        onClick={() => removeReference(index)}
                        disabled={!llmManageable || llmSaving}
                      >
                        Remove reference
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="calm-ghost mt-3 px-3 py-2 text-sm"
                  onClick={addReference}
                  disabled={!llmManageable || llmSaving}
                >
                  Add reference
                </button>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  className="calm-ghost px-3 py-2 text-sm"
                  onClick={onSaveLlmSettings}
                  disabled={!llmManageable || llmSaving}
                >
                  {llmSaving ? "Saving..." : "Save LLM settings"}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
