const computeProductPrices = (product) => {
  const plain = typeof product?.toObject === 'function'
    ? product.toObject()
    : { ...product };

  const originalPrice = Number(plain.price) || 0;
  const discountPrice = Number(plain.discountPrice) || 0;

  let sellingPrice;
  if (discountPrice > 0) {
    if (discountPrice >= originalPrice) {
      sellingPrice = originalPrice > 0 ? originalPrice : 0;
    } else {
      sellingPrice = discountPrice;
    }
  } else {
    sellingPrice = originalPrice;
  }

  if (sellingPrice < 0) {
    sellingPrice = 0;
  }

  const discountAmount = Math.max(0, originalPrice - sellingPrice);
  const discountPercentage = originalPrice > 0
    ? Math.round((discountAmount / originalPrice) * 100)
    : 0;
  const hasDiscount = discountAmount > 0 && sellingPrice < originalPrice;

  return {
    originalPrice,
    sellingPrice,
    discountAmount: Number(discountAmount.toFixed(2)),
    discountPercentage,
    hasDiscount,
  };
};

module.exports = { computeProductPrices };
