const computeProductPrices = (product) => {
  const plain = typeof product?.toObject === 'function'
    ? product.toObject()
    : { ...product };

  const originalPrice = Number(plain.price) || 0;
  const discountPrice = Number(plain.discountPrice) || 0;
  const hasStoredPercentage = plain.discountPercent !== undefined
    && plain.discountPercent !== null
    && plain.discountPercent !== '';
  const storedPercentage = hasStoredPercentage ? Number(plain.discountPercent) : null;
  const hasValidPercentage = Number.isFinite(storedPercentage)
    && storedPercentage >= 0
    && storedPercentage <= 100;
  const hasLegacyDiscount = !hasStoredPercentage
    && discountPrice > 0
    && discountPrice < originalPrice;
  const discountPercentage = hasValidPercentage
    ? storedPercentage
    : hasLegacyDiscount && originalPrice > 0
      ? ((originalPrice - discountPrice) / originalPrice) * 100
      : 0;
  const hasDiscount = discountPercentage > 0 && originalPrice > 0;
  const sellingPrice = hasLegacyDiscount
    ? discountPrice
    : hasDiscount
      ? Number((originalPrice * (1 - discountPercentage / 100)).toFixed(2))
    : originalPrice;

  const discountAmount = Math.max(0, originalPrice - sellingPrice);

  return {
    originalPrice,
    sellingPrice,
    discountAmount: Number(discountAmount.toFixed(2)),
    discountPercentage: Number(discountPercentage.toFixed(6)),
    discountPercent: Number(discountPercentage.toFixed(6)),
    pricingMode: hasStoredPercentage ? 'percentage' : hasLegacyDiscount ? 'legacy-fixed' : 'none',
    hasDiscount,
  };
};

module.exports = { computeProductPrices };
