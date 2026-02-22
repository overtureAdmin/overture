import { Document, Packer, Paragraph } from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type ExportFormat = "docx" | "pdf";

export type ExportArtifact = {
  bytes: Uint8Array;
  contentType: string;
  extension: ExportFormat;
};

function wrapLines(input: string, maxLen: number): string[] {
  const lines = input.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    let remaining = line.trimEnd();
    if (!remaining) {
      out.push("");
      continue;
    }
    while (remaining.length > maxLen) {
      out.push(remaining.slice(0, maxLen));
      remaining = remaining.slice(maxLen);
    }
    out.push(remaining);
  }
  return out;
}

async function renderPdf(content: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const lines = wrapLines(content, 100);
  let y = 760;
  for (const line of lines) {
    if (y < 40) {
      break;
    }
    page.drawText(line || " ", {
      x: 36,
      y,
      size: 11,
      font,
      color: rgb(0, 0, 0),
    });
    y -= 14;
  }
  return pdfDoc.save();
}

async function renderDocx(content: string): Promise<Uint8Array> {
  const lines = content.split("\n");
  const doc = new Document({
    sections: [
      {
        children: lines.map((line) => new Paragraph({ text: line || " " })),
      },
    ],
  });
  return Packer.toBuffer(doc);
}

export async function buildExportArtifact(params: {
  format: ExportFormat;
  content: string;
}): Promise<ExportArtifact> {
  if (params.format === "pdf") {
    return {
      bytes: await renderPdf(params.content),
      contentType: "application/pdf",
      extension: "pdf",
    };
  }
  return {
    bytes: await renderDocx(params.content),
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  };
}
