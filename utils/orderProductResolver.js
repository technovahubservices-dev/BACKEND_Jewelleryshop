const mongoose = require('mongoose');
const Product = require('../models/Product');
const AccessoryProduct = require('../models/AccessoryProduct');

const ACCESSORY_ID_PREFIX = 'accessory:';
const DEFAULT_STOREFRONT_GST_PERCENT = 5;

const normalizeObjectIdString = (value) => {
  if (value && typeof value === 'object' && value._id) {
    return String(value._id);
  }
  return String(value || '').trim();
};

const createHttpError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const parseOrderProductIdentifier = (value) => {
  const raw = normalizeObjectIdString(value);

  if (raw.startsWith(ACCESSORY_ID_PREFIX)) {
    const id = raw.slice(ACCESSORY_ID_PREFIX.length).trim();
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw createHttpError(`Invalid accessory product ID format: ${raw}`);
    }
    return {
      id,
      productType: 'accessory',
      productModel: 'AccessoryProduct',
      originalValue: raw,
    };
  }

  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
    throw createHttpError(`Invalid product ID format: ${raw}`);
  }

  return {
    id: raw,
    productType: 'jewellery',
    productModel: 'Product',
    originalValue: raw,
  };
};

const getProductPrice = (product, productType) => {
  if (productType === 'jewellery' && product.discountPrice && product.discountPrice > 0) {
    return Number(product.discountPrice) || 0;
  }
  return Number(product.price) || 0;
};

const getProductImage = (product) => {
  if (product.primaryImage) return product.primaryImage;
  if (!Array.isArray(product.images) || product.images.length === 0) return '';

  const first = product.images[0];
  if (typeof first === 'string') return first;
  return first?.url || first?.imageUrl || first?.src || '';
};

const getModelForOrderItem = (item) => {
  const modelName = item.productModel || (item.productType === 'accessory' ? 'AccessoryProduct' : 'Product');
  return modelName === 'AccessoryProduct' ? AccessoryProduct : Product;
};

const resolveOrderItemProduct = async (item, options = {}) => {
  const defaultGstPercent = options.defaultGstPercent ?? DEFAULT_STOREFRONT_GST_PERCENT;
  const parsed = parseOrderProductIdentifier(item.product);
  const Model = parsed.productModel === 'AccessoryProduct' ? AccessoryProduct : Product;
  const product = await Model.findById(parsed.id);

  if (!product) {
    throw createHttpError(
      parsed.productType === 'accessory'
        ? `Accessory product not found: ${parsed.id}`
        : `Product not found: ${parsed.id}`
    );
  }

  if (parsed.productType === 'accessory' && product.status !== 'active') {
    throw createHttpError(`Accessory product is not available: ${product.name}`);
  }

  const quantity = Number(item.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw createHttpError(`Invalid quantity for ${product.name}`);
  }

  if (Number(product.stock) < quantity) {
    throw createHttpError(
      `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${quantity}`
    );
  }

  const price = getProductPrice(product, parsed.productType);
  const lineTotal = price * quantity;
  const gstPercent = item.gst !== undefined && item.gst !== null && item.gst !== ''
    ? Number(item.gst) || 0
    : defaultGstPercent;

  return {
    orderItem: {
      product: product._id,
      productType: parsed.productType,
      productModel: parsed.productModel,
      name: product.name || item.name || '',
      image: item.image || getProductImage(product),
      sku: product.sku || '',
      price,
      quantity,
      discount: Number(item.discount) || 0,
      gst: gstPercent,
      lineTotal,
    },
    lineTotal,
  };
};

const buildOrderItems = async (items, options = {}) => {
  const orderItems = [];
  let calculatedItemsPrice = 0;

  for (const item of items) {
    const resolved = await resolveOrderItemProduct(item, options);
    orderItems.push(resolved.orderItem);
    calculatedItemsPrice += resolved.lineTotal;
  }

  return { orderItems, calculatedItemsPrice };
};

const updateStockForOrderItems = async (items, direction) => {
  const applied = [];

  for (const item of items) {
    const Model = getModelForOrderItem(item);
    const quantity = Number(item.quantity) || 0;
    if (!item.product || quantity < 1) continue;

    const filter = direction < 0
      ? { _id: item.product, stock: { $gte: quantity } }
      : { _id: item.product };

    if (direction < 0 && (item.productType === 'accessory' || item.productModel === 'AccessoryProduct')) {
      filter.status = 'active';
    }

    const result = await Model.updateOne(filter, { $inc: { stock: direction * quantity } });
    const modified = result.modifiedCount !== undefined ? result.modifiedCount : result.nModified;

    if (modified !== 1) {
      if (direction < 0 && applied.length > 0) {
        await updateStockForOrderItems(applied, 1);
      }
      throw createHttpError(`Unable to update stock for ${item.name || 'order item'}`);
    }

    applied.push(item);
  }

  return applied;
};

const deductStockForOrderItems = (items) => updateStockForOrderItems(items, -1);
const restoreStockForOrderItems = (items) => updateStockForOrderItems(items, 1);
const deductStockForOrder = (order) => deductStockForOrderItems(order.items || []);
const restoreStockForOrder = (order) => restoreStockForOrderItems(order.items || []);

module.exports = {
  ACCESSORY_ID_PREFIX,
  DEFAULT_STOREFRONT_GST_PERCENT,
  buildOrderItems,
  deductStockForOrder,
  deductStockForOrderItems,
  getProductImage,
  getProductPrice,
  parseOrderProductIdentifier,
  restoreStockForOrder,
  restoreStockForOrderItems,
  resolveOrderItemProduct,
};
