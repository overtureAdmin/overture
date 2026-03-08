import DocumentWorkspace from "./workspace";

type DocumentPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ doc?: string }>;
};

export default async function DocumentPage({ params, searchParams }: DocumentPageProps) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialDocumentId = resolvedSearchParams?.doc?.trim() || null;

  return <DocumentWorkspace threadId={id} initialDocumentId={initialDocumentId} />;
}
