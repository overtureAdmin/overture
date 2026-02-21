const demoThreads = [
  { id: "thr_1001", title: "Smith, Jane - Lumbar MRI Appeal" },
  { id: "thr_1002", title: "Turner, Alex - LMN for CGM Coverage" },
];

export default function AppPage() {
  return (
    <main className="grid min-h-screen grid-cols-1 md:grid-cols-[280px_1fr]">
      <aside className="border-r border-zinc-200 p-4">
        <h1 className="text-lg font-semibold">Threads</h1>
        <button className="mt-3 w-full rounded-md bg-zinc-900 px-3 py-2 text-sm text-white">
          New Thread
        </button>
        <ul className="mt-4 space-y-2">
          {demoThreads.map((thread) => (
            <li key={thread.id} className="rounded-md border border-zinc-200 p-3 text-sm">
              {thread.title}
            </li>
          ))}
        </ul>
      </aside>

      <section className="p-6">
        <h2 className="text-2xl font-semibold">Case Workspace</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Upload source files, draft with chat, and generate LMN/Appeal/P2P outputs.
        </p>
      </section>
    </main>
  );
}
