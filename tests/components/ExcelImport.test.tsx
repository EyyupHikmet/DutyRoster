import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExcelImport } from "../../src/components/ExcelImport";

describe("ExcelImport", () => {
  it("renders the Turkish upload prompt and expected column names", () => {
    render(<ExcelImport onFileImport={() => {}} />);
    expect(screen.getByText("Excel / CSV Dosyası Yükle")).toBeInTheDocument();
    expect(screen.getByText(/Ad, Hedef Saat, Kıdem/)).toBeInTheDocument();
  });

  it("has a hidden file input wired to onFileImport, accepting the right extensions", () => {
    const onFileImport = vi.fn();
    const { container } = render(<ExcelImport onFileImport={onFileImport} />);
    const input = container.querySelector("#excel-import-file") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.type).toBe("file");
    expect(input.accept).toBe(".xlsx, .xls, .csv");

    const file = new File(["dummy"], "roster.xlsx");
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onFileImport).toHaveBeenCalled();
  });
});
