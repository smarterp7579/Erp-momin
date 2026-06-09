import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

interface BarcodeGeneratorProps {
  value: string;
  format?: "CODE128" | "EAN13" | "CODE39" | "ITF" | "MSI" | "PHARMACODE";
  width?: number;
  height?: number;
  displayValue?: boolean;
  fontSize?: number;
}

export function BarcodeGenerator({
  value,
  format = "CODE128",
  width = 1.8,
  height = 40,
  displayValue = true,
  fontSize = 12,
}: BarcodeGeneratorProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format,
          width,
          height,
          displayValue,
          fontSize,
          margin: 4,
          background: "transparent",
          lineColor: "#000000",
        });
      } catch (err) {
        console.error("Barcode generation failed for:", value, err);
      }
    }
  }, [value, format, width, height, displayValue, fontSize]);

  return <svg ref={svgRef} className="mx-auto block" />;
}
