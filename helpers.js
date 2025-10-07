export function parsePrice(priceStr = "") {
  const num = parseFloat(
    priceStr.toString().replace(/[^\d.,]/g, "").replace(",", ".")
  );
  return isNaN(num) ? null : num;
}

export function isFreyaVariantAvailable(variant) {
  return (
    variant?.available === true ||
    (variant?.inventory_quantity ?? 0) > 0 ||
    variant?.inventory_policy === "continue"
  );
}