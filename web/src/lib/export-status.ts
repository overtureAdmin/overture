export type ExportStatusRecord = {
  id: string;
  generated_document_id: string;
  format: "docx" | "pdf";
  status: "queued" | "processing" | "completed" | "failed";
  storage_key: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export function exportDownloadFileName(record: {
  generated_document_id: string;
  format: "docx" | "pdf";
}): string {
  return `unity-appeals-${record.generated_document_id}.${record.format}`;
}

export async function buildExportStatusPayload(
  record: ExportStatusRecord,
  createDownloadUrl: (params: { key: string; fileName: string; expiresInSeconds: number }) => Promise<string>,
) {
  let downloadUrl: string | null = null;
  if (record.status === "completed" && record.storage_key) {
    downloadUrl = await createDownloadUrl({
      key: record.storage_key,
      fileName: exportDownloadFileName(record),
      expiresInSeconds: 900,
    });
  }

  return {
    exportId: record.id,
    documentId: record.generated_document_id,
    format: record.format,
    status: record.status,
    errorMessage: record.error_message,
    storageKey: record.storage_key,
    downloadUrl,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}
