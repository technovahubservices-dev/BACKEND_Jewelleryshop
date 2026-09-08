const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');

const getProductPrice = (product) => {
  if (product.discountPrice && product.discountPrice > 0) {
    return product.discountPrice;
  }
  return product.price || 0;
};

const resolveShippingAddress = async (req, shippingAddress, addressId) => {
  if (addressId) {
    if (!mongoose.Types.ObjectId.isValid(addressId)) {
      const error = new Error('Invalid address ID');
      error.statusCode = 400;
      throw error;
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    const savedAddress = user.addresses.id(addressId);
    if (!savedAddress) {
      const error = new Error('Address not found');
      error.statusCode = 404;
      throw error;
    }

    return {
      fullName: savedAddress.fullName,
      phone: savedAddress.phone || '',
      address: savedAddress.address,
      landmark: savedAddress.landmark || '',
      city: savedAddress.city,
      state: savedAddress.state,
      pincode: savedAddress.pincode || '',
    };
  }

  if (!shippingAddress || !shippingAddress.fullName || !shippingAddress.address ||
      !shippingAddress.city || !shippingAddress.state) {
    const error = new Error('Shipping address is required');
    error.statusCode = 400;
    throw error;
  }

  return shippingAddress;
};

const buildOrderItems = async (items) => {
  const orderItems = [];
  let calculatedItemsPrice = 0;

  for (const item of items) {
    if (!item.product || !mongoose.Types.ObjectId.isValid(item.product)) {
      const error = new Error(`Invalid product ID format: ${item.product}`);
      error.statusCode = 400;
      throw error;
    }

    const product = await Product.findById(item.product);
    if (!product) {
      const error = new Error(`Product not found: ${item.product}`);
      error.statusCode = 400;
      throw error;
    }

    if (product.stock < item.quantity) {
      const error = new Error(
        `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.quantity}`
      );
      error.statusCode = 400;
      throw error;
    }

    const price = getProductPrice(product);
    const lineTotal = price * item.quantity;
    calculatedItemsPrice += lineTotal;

    orderItems.push({
      product: product._id,
      name: item.name || product.name,
      image:
        item.image ||
        product.primaryImage ||
        (product.images && product.images[0]) ||
        '',
      price: price,
      quantity: item.quantity,
    });
  }

  return { orderItems, calculatedItemsPrice };
};

const createOrderFromItems = async (req, items, addressInput, idempotencyKey) => {
  const { orderItems, calculatedItemsPrice } = await buildOrderItems(items);

  if (orderItems.length === 0) {
    const error = new Error('Order must contain at least one item');
    error.statusCode = 400;
    throw error;
  }

  const { shippingAddress, shippingPrice = 0, taxPrice = 0, discount = 0, paymentMethod = 'cod' } = addressInput;

  const resolvedAddress = await resolveShippingAddress(
    req,
    shippingAddress,
    addressInput.addressId
  );

  const isPrepaid = paymentMethod && paymentMethod !== 'cod';
  const calculatedTotalPrice =
    calculatedItemsPrice + Number(taxPrice || 0) + Number(shippingPrice || 0) - Number(discount || 0);

  const userId = req.user && mongoose.Types.ObjectId.isValid(req.user._id)
    ? req.user._id
    : undefined;

  const order = await Order.create({
    user: userId,
    items: orderItems,
    shippingAddress: resolvedAddress,
    paymentMethod: paymentMethod || 'cod',
    itemsPrice: calculatedItemsPrice,
    taxPrice: Number(taxPrice || 0),
    shippingPrice: Number(shippingPrice || 0),
    discount: Number(discount || 0),
    totalPrice: calculatedTotalPrice,
    isPaid: false,
    status: isPrepaid ? 'pending_payment' : 'new',
    paymentStatus: 'pending',
    shippingStatus: 'not_shipped',
    idempotencyKey: idempotencyKey || undefined,
    statusHistory: [
      {
        status: isPrepaid ? 'pending_payment' : 'new',
        timestamp: new Date(),
        note: isPrepaid ? 'Order awaiting payment' : 'Order placed',
        updatedBy: userId,
      },
    ],
  });

  if (!isPrepaid) {
    for (const item of orderItems) {
      if (item.product && mongoose.Types.ObjectId.isValid(item.product)) {
        await Product.findByIdAndUpdate(
          item.product,
          { $inc: { stock: -item.quantity } },
          { new: true }
        );
      }
    }
  }

  await Order.populate(order, { path: 'items.product' });

  return order;
};

exports.getCart = asyncHandler(async (req, res) => {
  let cart = await Cart.findOne({ user: req.user._id }).populate(
    'items.product',
    'name price discountPrice primaryImage images stock status'
  );

  if (!cart) {
    cart = await Cart.create({ user: req.user._id, items: [] });
  }

  const normalizedItems = cart.items.map((item) => {
    const product = item.product;
    let productObj = null;
    let itemPrice = item.price;

    if (typeof product?.toObject === 'function') {
      productObj = product.toObject();
      itemPrice = getProductPrice(productObj);
    } else if (product) {
      productObj = product;
      itemPrice = getProductPrice(productObj);
    }

    return {
      _id: item._id,
      product: productObj,
      quantity: item.quantity,
      price: itemPrice,
      totalPrice: itemPrice * item.quantity,
    };
  });

  const totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = normalizedItems.reduce(
    (sum, item) => sum + item.totalPrice,
    0
  );

  res.status(200).json({
    success: true,
    data: {
      items: normalizedItems,
      totalItems,
      totalPrice,
    },
  });
});

exports.addToCart = asyncHandler(async (req, res) => {
  const { productId, quantity = 1 } = req.body;

  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    return res.status(400).json({
      success: false,
      message: 'Valid product ID is required',
    });
  }

  const product = await Product.findById(productId);
  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found',
    });
  }

  if (product.status !== 'active') {
    return res.status(400).json({
      success: false,
      message: 'Product is not available',
    });
  }

  const qty = Math.max(1, parseInt(quantity, 10) || 1);

  if (product.stock < qty) {
    return res.status(400).json({
      success: false,
      message: `Insufficient stock. Available: ${product.stock}`,
    });
  }

  const price = getProductPrice(product);

  let cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    cart = new Cart({ user: req.user._id, items: [] });
  }

  const existingItemIndex = cart.items.findIndex(
    (item) => item.product.toString() === productId
  );

  if (existingItemIndex > -1) {
    const newQuantity = cart.items[existingItemIndex].quantity + qty;
    if (product.stock < newQuantity) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock. Available: ${product.stock}, Already in cart: ${cart.items[existingItemIndex].quantity}, Requested: ${qty}`,
      });
    }
    cart.items[existingItemIndex].quantity = newQuantity;
    cart.items[existingItemIndex].price = price;
  } else {
    cart.items.push({
      product: product._id,
      quantity: qty,
      price,
    });
  }

  await cart.save();
  await cart.populate('items.product', 'name price discountPrice primaryImage images stock status');

  const normalizedItems = cart.items.map((item) => {
    const productObj = item.product?.toObject
      ? item.product.toObject()
      : item.product || null;
    const itemPrice = productObj ? getProductPrice(productObj) : item.price;
    return {
      _id: item._id,
      product: productObj,
      quantity: item.quantity,
      price: itemPrice,
      totalPrice: itemPrice * item.quantity,
    };
  });

  const totalItems = normalizedItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = normalizedItems.reduce((sum, item) => sum + item.totalPrice, 0);

  res.status(200).json({
    success: true,
    message: 'Product added to cart',
    data: {
      items: normalizedItems,
      totalItems,
      totalPrice,
    },
  });
});

exports.updateCartItem = asyncHandler(async (req, res) => {
  const { itemId } = req.params;
  const { quantity } = req.body;

  if (!mongoose.Types.ObjectId.isValid(itemId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid item ID',
    });
  }

  if (!quantity || quantity < 1) {
    return res.status(400).json({
      success: false,
      message: 'Quantity must be at least 1',
    });
  }

  const qty = parseInt(quantity, 10);

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart || cart.items.length === 0) {
    return res.status(404).json({
      success: false,
      message: 'Cart is empty',
    });
  }

  const itemIndex = cart.items.findIndex(
    (item) => item._id.toString() === itemId
  );

  if (itemIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Cart item not found',
    });
  }

  const product = await Product.findById(cart.items[itemIndex].product);
  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found',
    });
  }

  if (product.stock < qty) {
    return res.status(400).json({
      success: false,
      message: `Insufficient stock. Available: ${product.stock}`,
    });
  }

  const price = getProductPrice(product);
  cart.items[itemIndex].quantity = qty;
  cart.items[itemIndex].price = price;
  await cart.save();

  await cart.populate('items.product', 'name price discountPrice primaryImage images stock status');

  const normalizedItems = cart.items.map((item) => {
    const productObj = item.product?.toObject
      ? item.product.toObject()
      : item.product || null;
    const itemPrice = productObj ? getProductPrice(productObj) : item.price;
    return {
      _id: item._id,
      product: productObj,
      quantity: item.quantity,
      price: itemPrice,
      totalPrice: itemPrice * item.quantity,
    };
  });

  const totalItems = normalizedItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = normalizedItems.reduce((sum, item) => sum + item.totalPrice, 0);

  res.status(200).json({
    success: true,
    message: 'Cart item updated',
    data: {
      items: normalizedItems,
      totalItems,
      totalPrice,
    },
  });
});

exports.removeFromCart = asyncHandler(async (req, res) => {
  const { itemId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(itemId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid item ID',
    });
  }

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart || cart.items.length === 0) {
    return res.status(404).json({
      success: false,
      message: 'Cart is empty',
    });
  }

  const itemIndex = cart.items.findIndex(
    (item) => item._id.toString() === itemId
  );

  if (itemIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Cart item not found',
    });
  }

  cart.items.splice(itemIndex, 1);
  await cart.save();

  await cart.populate('items.product', 'name price discountPrice primaryImage images stock status');

  const normalizedItems = cart.items.map((item) => {
    const productObj = item.product?.toObject
      ? item.product.toObject()
      : item.product || null;
    const itemPrice = productObj ? getProductPrice(productObj) : item.price;
    return {
      _id: item._id,
      product: productObj,
      quantity: item.quantity,
      price: itemPrice,
      totalPrice: itemPrice * item.quantity,
    };
  });

  const totalItems = normalizedItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = normalizedItems.reduce((sum, item) => sum + item.totalPrice, 0);

  res.status(200).json({
    success: true,
    message: 'Product removed from cart',
    data: {
      items: normalizedItems,
      totalItems,
      totalPrice,
    },
  });
});

exports.clearCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart || cart.items.length === 0) {
    return res.status(200).json({
      success: true,
      message: 'Cart is already empty',
      data: {
        items: [],
        totalItems: 0,
        totalPrice: 0,
      },
    });
  }

  cart.items = [];
  await cart.save();

  res.status(200).json({
    success: true,
    message: 'Cart cleared',
    data: {
      items: [],
      totalItems: 0,
      totalPrice: 0,
    },
  });
});

exports.buyNow = asyncHandler(async (req, res) => {
  const {
    productId,
    quantity = 1,
    shippingAddress,
    addressId,
    paymentMethod = 'cod',
    taxPrice,
    shippingPrice,
    discount,
    idempotencyKey,
  } = req.body;

  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    return res.status(400).json({
      success: false,
      message: 'Valid product ID is required',
    });
  }

  const product = await Product.findById(productId);
  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found',
    });
  }

  if (product.status !== 'active') {
    return res.status(400).json({
      success: false,
      message: 'Product is not available',
    });
  }

  const qty = Math.max(1, parseInt(quantity, 10) || 1);

  if (product.stock < qty) {
    return res.status(400).json({
      success: false,
      message: `Insufficient stock. Available: ${product.stock}`,
    });
  }

  const items = [
    {
      product: product._id,
      name: product.name,
      image:
        product.primaryImage ||
        (product.images && product.images[0]) ||
        '',
      quantity: qty,
    },
  ];

  try {
    const order = await createOrderFromItems(
      req,
      items,
      {
        shippingAddress,
        addressId,
        taxPrice,
        shippingPrice,
        discount,
        paymentMethod,
      },
      idempotencyKey
    );

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: order,
    });
  } catch (error) {
    console.error('Buy Now error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to create order',
    });
  }
});

exports.checkout = asyncHandler(async (req, res) => {
  const {
    shippingAddress,
    addressId,
    paymentMethod = 'cod',
    taxPrice,
    shippingPrice,
    discount,
    idempotencyKey,
  } = req.body;

  const cart = await Cart.findOne({ user: req.user._id }).populate(
    'items.product'
  );

  if (!cart || cart.items.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Cart is empty',
    });
  }

  const items = cart.items.map((item) => ({
    product: item.product._id,
    name: item.name || item.product.name,
    image: item.image || item.product.primaryImage || (item.product.images && item.product.images[0]) || '',
    quantity: item.quantity,
  }));

  try {
    const order = await createOrderFromItems(
      req,
      items,
      {
        shippingAddress,
        addressId,
        taxPrice,
        shippingPrice,
        discount,
        paymentMethod,
      },
      idempotencyKey
    );

    cart.items = [];
    await cart.save();

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: order,
    });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to create order',
    });
  }
});

