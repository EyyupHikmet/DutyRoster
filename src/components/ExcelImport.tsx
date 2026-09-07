import React from "react";

interface ExcelImportProps {
  onFileImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const ExcelImport: React.FC<ExcelImportProps> = ({ onFileImport }) => {
  return (
    // This was a plain onClick <div> forwarding to a `display:none` <input
    // type="file"> — `display:none` removes an element from the tab order
    // entirely, so the whole Excel/CSV import feature was unreachable from
    // the keyboard. A <label htmlFor> wrapping the same visible
    // content is the native way to make a file input's custom-styled trigger
    // both clickable (as before) AND keyboard-operable: the <input> itself
    // stays in the tab order (kept on-screen via .sr-only, not
    // display:none/visibility:hidden, both of which are still unfocusable),
    // and a focused file input opens its native picker on Enter/Space same
    // as any browser default — no extra key handling code needed.
    <label
      htmlFor="excel-import-file"
      className="import-section"
      style={{
        marginBottom: "20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        borderRadius: "12px",
        border: "1.5px dashed var(--slate-300)",
        backgroundColor: "var(--slate-50)",
        cursor: "pointer",
        textAlign: "center",
        transition: "all 0.2s ease"
      }}
    >
      <div style={{ fontSize: "1.6rem", marginBottom: "6px" }} aria-hidden="true">📥</div>
      <div className="import-label" style={{ fontWeight: "700", color: "var(--primary)", fontSize: "0.9rem" }}>
        Excel / CSV Dosyası Yükle
      </div>
      <p style={{ margin: "4px 0 0 0", fontSize: "0.75rem", color: "var(--slate-600)", lineHeight: "1.1rem" }}>
        Sürükleyin veya tıklayın. Kolonlar: <strong>Ad, Hedef Saat, Kıdem</strong>
        <br />Yalnızca isimlerden oluşan tek sütunlu bir liste de yükleyebilirsiniz.
      </p>

      <input
        type="file"
        id="excel-import-file"
        accept=".xlsx, .xls, .csv"
        className="sr-only"
        onChange={onFileImport}
      />
    </label>
  );
};
