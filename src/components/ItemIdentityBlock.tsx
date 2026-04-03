import { format } from "date-fns";

interface ItemIdentityBlockProps {
  brandName?: string | null;
  productNumber?: string | null;
  packSize?: string | null;
  lastOrderedDate?: string | null;
  className?: string;
}

/**
 * Renders a compact identity sub-line under an item name.
 * Example: Brand • #58212 • 24/3.2 Oz • Last ordered 02/20/26
 */
export default function ItemIdentityBlock({
  brandName,
  productNumber,
  packSize,
  lastOrderedDate,
  className = "",
}: ItemIdentityBlockProps) {
  const parts: string[] = [];

  if (brandName) parts.push(String(brandName));
  if (productNumber) parts.push(`#${productNumber}`);
  if (packSize) parts.push(packSize);

  if (lastOrderedDate) {
    try {
      parts.push(`Last ordered ${format(new Date(lastOrderedDate), "MM/dd/yy")}`);
    } catch {
      parts.push("Last ordered —");
    }
  }

  if (parts.length === 0) return null;

  return (
    <span className={`text-[10px] text-muted-foreground/60 leading-tight ${className}`}>
      {parts.join(" • ")}
    </span>
  );
}
