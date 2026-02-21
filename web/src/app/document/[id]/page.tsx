type DocumentPageProps = {
  params: Promise<{ id: string }>;
};

export default async function DocumentPage({ params }: DocumentPageProps) {
  const { id } = await params;

  return (
    <main className="grid min-h-screen grid-cols-1 md:grid-cols-[1fr_380px]">
      <section className="p-6">
        <h1 className="text-2xl font-semibold">Document Editor</h1>
        <p className="mt-2 text-sm text-zinc-600">Document ID: {id}</p>
        <div className="mt-4 min-h-[420px] rounded-lg border border-zinc-200 p-4 text-sm">
          Editor canvas placeholder
        </div>
      </section>
      <aside className="border-l border-zinc-200 p-6">
        <h2 className="text-lg font-semibold">Revision Chat</h2>
        <div className="mt-4 min-h-[420px] rounded-lg border border-zinc-200 p-4 text-sm">
          Chat feed placeholder
        </div>
      </aside>
    </main>
  );
}
