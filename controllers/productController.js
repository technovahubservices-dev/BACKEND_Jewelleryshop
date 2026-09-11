const Product = require('../models/Product');
const User = require('../models/User');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const {
  deleteDriveFilesForUrls,
  normalizeGoogleDriveUrl,
  uploadRequestFilesToGoogleDrive,
} = require('../utils/googleDriveStorage');
const { computeProductPrices } = require('../utils/discountCalculator');

const VALID_COLLECTIONS = [
  'Heritage', 'Eternal', 'Blossom', 'Celeste', 'Aura',
  'New Arrival', 'Best Seller', 'Bridal', 'Wedding', 'Occasion',
  'Fine Jewellery',
];

const VALID_OCCASIONS = [
  'Bridal', 'Wedding', 'Engagement', 'Party',
  'Festive', 'Everyday', 'Anniversary', 'Gift',
];

const normalizeImage = (img, index) => {
  if (typeof img === 'string') {
    return {
      url: normalizeGoogleDriveUrl(img),
      alt: '',
      order: index,
    };
  }
  if (typeof img === 'object' && img !== null) {
    const rawUrl = img.url
      || img.imageUrl
      || img.src
      || img.path
      || '';
    return {
      url: normalizeGoogleDriveUrl(rawUrl),
      alt: img.alt || img.title || '',
      order: img.order !== undefined ? img.order : index,
    };
  }
  return { url: '', alt: '', order: index };
};

const extractImageUrl = (img) => {
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (typeof img === 'object' && img !== null) return img.url || '';
  return '';
};

const normalizeProductImages = (product) => {
  const plainProduct = typeof product?.toObject === 'function'
    ? product.toObject()
    : { ...product };

  if (!plainProduct) {
    return plainProduct;
  }

  if (Array.isArray(plainProduct.images)) {
    plainProduct.images = plainProduct.images.map((img, index) =>
      normalizeImage(img, index)
    );
    plainProduct.images.sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!plainProduct.primaryImage && plainProduct.images.length > 0) {
      plainProduct.primaryImage = plainProduct.images[0].url || '';
    }
  } else if (Array.isArray(plainProduct.imageUrls)) {
    plainProduct.images = plainProduct.imageUrls.map((url, index) =>
      normalizeImage(url, index)
    );
    plainProduct.images.sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!plainProduct.primaryImage && plainProduct.images.length > 0) {
      plainProduct.primaryImage = plainProduct.images[0].url || '';
    }
  }

  if (plainProduct.primaryImage) {
    plainProduct.primaryImage = normalizeGoogleDriveUrl(plainProduct.primaryImage);
  }

  if (plainProduct.productVideoUrl) {
    plainProduct.productVideoUrl = normalizeGoogleDriveUrl(plainProduct.productVideoUrl);
  }

  if (plainProduct.productVideoThumbnail) {
    plainProduct.productVideoThumbnail = normalizeGoogleDriveUrl(plainProduct.productVideoThumbnail);
  }

  const prices = computeProductPrices(plainProduct);
  Object.assign(plainProduct, prices);

  return plainProduct;
};

const normalizeProductListing = (product) => {
  const plainProduct = normalizeProductImages(product);

  delete plainProduct.description;

  return plainProduct;
};

const generateSKU = (name, category, metal) => {
  const metalMap = {
    Gold: 'GOLD',
    Silver: 'SILV',
    Platinum: 'PLAT',
    'Rose Gold': 'RPG',
    'White Gold': 'WGLD',
  };

  const categoryMap = {
    Rings: 'RNG',
    Necklaces: 'NEC',
    Earrings: 'ERG',
    Bracelets: 'BRC',
    Bangles: 'BNG',
    Chains: 'CHN',
    Sets: 'SET',
  };

  const metalCode = metalMap[metal] || 'GOLD';
  const categoryCode = categoryMap[category] || 'PRD';

  return `${metalCode}-${categoryCode}`;
};

const getNextSkuNumber = async (skuPrefix) => {
  const regex = new RegExp(`^${skuPrefix}-(\\d{3})$`);
  const products = await Product.find({ sku: regex }).select('sku').lean();
  const lastProduct = products.sort((a, b) => {
    const aNum = parseInt(a.sku.match(regex)?.[1] || '0', 10);
    const bNum = parseInt(b.sku.match(regex)?.[1] || '0', 10);
    return bNum - aNum;
  })[0];

  let num = 1;
  if (lastProduct) {
    const match = lastProduct.sku.match(regex);
    if (match) {
      num = parseInt(match[1], 10) + 1;
    }
  }

  return num.toString().padStart(3, '0');
};

exports.createProduct = async (req, res) => {
  try {
    console.log('[Product Create] Incoming multipart payload', {
      bodyKeys: Object.keys(req.body || {}),
      fileCount: Array.isArray(req.files) ? req.files.length : 0,
      files: Array.isArray(req.files)
        ? req.files.map((file) => ({
            fieldname: file.fieldname,
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            path: file.path,
          }))
        : [],
    });

    const {
      name,
      sku: manualSku,
      description,
      price,
      discountPrice,
      stock,
      category,
      subcategory,
      jewelleryCollection,
      metal,
      purity,
      weight,
      diamondWeight,
      diamondShape,
      diamondClarity,
      diamondColor,
      productVideoUrl,
      productVideoThumbnail,
    tags,
    status,
    isFeatured,
    isBestSeller,
    isNewArrival,
    reservedStock,
    minimumStock,
    availableWeight,
    occasion,
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Product name is required',
    });
  }

  if (!category || !category.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Category is required',
    });
  }

  if (jewelleryCollection && !VALID_COLLECTIONS.includes(jewelleryCollection)) {
    return res.status(400).json({
      success: false,
      message: `Invalid collection. Valid values: ${VALID_COLLECTIONS.join(', ')}`,
    });
  }

  if (occasion && !VALID_OCCASIONS.includes(occasion)) {
    return res.status(400).json({
      success: false,
      message: `Invalid occasion. Valid values: ${VALID_OCCASIONS.join(', ')}`,
    });
  }

  if (discountPrice !== undefined && discountPrice !== '' && discountPrice !== null) {
    const parsedDiscount = parseFloat(discountPrice);
    const parsedPrice = price !== undefined && price !== '' ? parseFloat(price) : 0;
    if (!isNaN(parsedDiscount) && parsedDiscount < 0) {
      return res.status(400).json({
        success: false,
        message: 'Discount price cannot be negative',
      });
    }
    if (!isNaN(parsedDiscount) && !isNaN(parsedPrice) && parsedDiscount >= parsedPrice) {
      return res.status(400).json({
        success: false,
        message: 'Discount price must be less than the regular price',
      });
    }
  }

  if (price !== undefined && price !== '' && price !== null) {
    const parsedPrice = parseFloat(price);
    if (!isNaN(parsedPrice) && parsedPrice < 0) {
      return res.status(400).json({
        success: false,
        message: 'Price cannot be negative',
      });
    }
  }

    // SKU validation must happen BEFORE any image upload to Google Drive,
    // so that duplicate SKUs are rejected early and do not leave orphaned files.
    let sku = manualSku ? manualSku.trim() : '';
    if (sku) {
      const existingProduct = await Product.findOne({ sku });
      if (existingProduct) {
        return res.status(400).json({
          success: false,
          message: 'A product with this SKU already exists',
        });
      }
    }

    const driveFiles = await uploadRequestFilesToGoogleDrive(req, { makePublic: true });
    const uploadedFiles = driveFiles.map((file) => file.viewUrl || file.url);
    console.log('[Product Create] Drive upload result', {
      uploadedCount: driveFiles.length,
      uploadedFiles,
    });

    if (req.files && req.files.length > 0) {
      const invalidUpload = req.files.some((file) => !String(file.mimetype || '').startsWith('image/'));
      if (invalidUpload) {
        return res.status(400).json({
          success: false,
          message: 'Invalid file type. Only image files are allowed.',
        });
      }
    }

    let imageUrls = [];
    if (typeof req.body.imageUrls === 'string') {
      try {
        imageUrls = JSON.parse(req.body.imageUrls);
      } catch (e) {
        if (req.body.imageUrls.trim()) {
          imageUrls = req.body.imageUrls.split(',').map((u) => u.trim()).filter(Boolean);
        }
      }
    } else if (Array.isArray(req.body.imageUrls)) {
      imageUrls = req.body.imageUrls;
    }

    if (imageUrls.length > 0) {
      const invalidUrl = imageUrls.some((img) => {
        const url = extractImageUrl(img);
        if (!url || typeof url !== 'string') return true;
        return !url.startsWith('/') && !url.startsWith('http://') && !url.startsWith('https://');
      });
      if (invalidUrl) {
        return res.status(400).json({
          success: false,
          message: 'Invalid image URL format',
        });
      }
    }

    const normalizedImageUrls = imageUrls.map((img) => {
      if (typeof img === 'string') {
        return normalizeGoogleDriveUrl(img);
      }
      if (typeof img === 'object' && img !== null) {
        return {
          url: normalizeGoogleDriveUrl(img.url || img.imageUrl || img.src || img.path || ''),
          alt: img.alt || '',
          order: img.order !== undefined ? img.order : 0,
        };
      }
      return img;
    });
    const images = [...normalizedImageUrls, ...uploadedFiles];

    if (images.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one product image is required (upload or URL)',
      });
    }

    if (!sku) {
      const skuPrefix = generateSKU(name, category, metal);
      let retries = 0;
      while (retries < 5) {
        const skuNum = await getNextSkuNumber(skuPrefix);
        sku = `${skuPrefix}-${skuNum}`;

        const existing = await Product.findOne({ sku });
        if (!existing) break;

        retries++;
        if (retries >= 5) {
          return res.status(400).json({
            success: false,
            message: 'Could not generate a unique SKU. Please provide a manual SKU.',
          });
        }
      }
    }

    let parsedTags = tags;
    if (typeof tags === 'string') {
      parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t);
    }

    const primaryImage = extractImageUrl(images[0]);

    const productData = {
      name: name.trim(),
      sku,
      category,
      description: description || undefined,
      images,
      primaryImage,
      productVideoUrl: productVideoUrl || '',
      productVideoThumbnail: productVideoThumbnail || '',
      tags: parsedTags || [],
      status: status || 'active',
      isFeatured: isFeatured === true || isFeatured === 'true' || isFeatured === 1,
      isBestSeller:
        isBestSeller === true || isBestSeller === 'true' || isBestSeller === 1,
      isNewArrival:
        isNewArrival === true || isNewArrival === 'true' || isNewArrival === 1,
    };

    if (price !== undefined && price !== '') productData.price = parseFloat(price);
    if (discountPrice !== undefined && discountPrice !== '') productData.discountPrice = parseFloat(discountPrice);
    if (stock !== undefined && stock !== '') productData.stock = parseInt(stock, 10);
    if (subcategory) productData.subcategory = subcategory;
    if (jewelleryCollection) productData.jewelleryCollection = jewelleryCollection;
    if (occasion) productData.occasion = occasion;
    if (metal) productData.metal = metal;
    if (purity) productData.purity = purity;
    if (weight) productData.weight = weight;
    if (diamondWeight) productData.diamondWeight = diamondWeight;
    if (diamondShape) productData.diamondShape = diamondShape;
    if (diamondClarity) productData.diamondClarity = diamondClarity;
    if (diamondColor) productData.diamondColor = diamondColor;
    if (reservedStock !== undefined && reservedStock !== '') productData.reservedStock = parseInt(reservedStock, 10);
    if (minimumStock !== undefined && minimumStock !== '') productData.minimumStock = parseInt(minimumStock, 10);
    if (availableWeight) productData.availableWeight = availableWeight;

    const product = await Product.create(productData);

    const responseProduct = normalizeProductImages(product);
    console.log('[Product Create] Saved product image urls', {
      productId: responseProduct._id,
      images: responseProduct.images,
      primaryImage: responseProduct.primaryImage,
    });

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: responseProduct,
    });
  } catch (error) {
    console.error('Create product error:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', '),
      });
    }
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A product with this SKU already exists',
      });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to create product',
    });
  }
};

exports.checkSkuAvailability = asyncHandler(async (req, res) => {
  const { sku } = req.query;

  if (!sku || !sku.trim()) {
    return res.status(400).json({
      success: false,
      message: 'SKU query parameter is required',
    });
  }

  const existingProduct = await Product.findOne({ sku: sku.trim() });

  res.status(200).json({
    success: true,
    available: !existingProduct,
    sku: sku.trim(),
  });
});

exports.getProductBySku = asyncHandler(async (req, res) => {
  const { sku } = req.params;

  if (!sku || !sku.trim()) {
    return res.status(400).json({
      success: false,
      message: 'SKU parameter is required',
    });
  }

  const product = await Product.findOne({ sku: sku.trim() });

  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found',
    });
  }

  res.status(200).json({
    success: true,
    data: normalizeProductImages(product),
  });
});

exports.getProducts = async (req, res) => {
  try {
    const {
      search,
      category,
      subcategory,
      collection,
      jewelleryCollection,
      metal,
      purity,
      status,
      minPrice,
      maxPrice,
      inStock,
      availability,
      isFeatured,
      isBestSeller,
      isNewArrival,
      discount,
      occasion,
      bridal,
      wedding,
      diamondShape,
      diamondClarity,
      diamondColor,
      sort = '-createdAt',
      page = 1,
      limit = 20,
      fields,
    } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } },
        { subcategory: { $regex: search, $options: 'i' } },
        { jewelleryCollection: { $regex: search, $options: 'i' } },
        { occasion: { $regex: search, $options: 'i' } },
      ];
    }

    if (category) {
      const trimmedCategory = String(category).trim();
      if (trimmedCategory) {
        const escaped = trimmedCategory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.category = { $regex: new RegExp(`^${escaped}$`, 'i') };
      }
    }

    if (subcategory) {
      query.subcategory = String(subcategory);
    }

    if (collection || jewelleryCollection) {
      const col = collection || jewelleryCollection;
      if (col) {
        const trimmedCol = String(col).trim();
        if (trimmedCol) {
          query.jewelleryCollection = trimmedCol;
        }
      }
    }

    if (occasion) {
      const trimmedOccasion = String(occasion).trim();
      if (trimmedOccasion) {
        query.occasion = trimmedOccasion;
      }
    }

    if (bridal === 'true' || bridal === true) {
      query.occasion = 'Bridal';
    }

    if (wedding === 'true' || wedding === true) {
      query.occasion = 'Wedding';
    }

    if (metal) {
      query.metal = String(metal);
    }

    if (purity) {
      const activeCollection = query.jewelleryCollection;
      if (activeCollection !== 'Fine Jewellery') {
        query.purity = String(purity);
      }
    }

    if (diamondShape) {
      query.diamondShape = String(diamondShape);
    }

    if (diamondClarity) {
      query.diamondClarity = String(diamondClarity);
    }

    if (diamondColor) {
      query.diamondColor = String(diamondColor);
    }

    if (status) {
      query.status = String(status);
    } else {
      query.status = 'active';
    }

    if (minPrice !== undefined && minPrice !== '') {
      const min = parseFloat(minPrice);
      if (!isNaN(min)) {
        query.$and = query.$and || [];
        query.$and.push({
          $or: [
            { discountPrice: { $gt: 0, $gte: min } },
            { discountPrice: { $lte: 0 }, price: { $gte: min } },
          ],
        });
      }
    }

    if (maxPrice !== undefined && maxPrice !== '') {
      const max = parseFloat(maxPrice);
      if (!isNaN(max)) {
        query.$and = query.$and || [];
        query.$and.push({
          $or: [
            { discountPrice: { $gt: 0, $lte: max } },
            { discountPrice: { $lte: 0 }, price: { $lte: max } },
          ],
        });
      }
    }

    if (availability) {
      const avail = String(availability).trim().toLowerCase();
      if (avail === 'in-stock' || avail === 'true') {
        query.stock = { $gt: 0 };
      } else if (avail === 'out-of-stock') {
        query.stock = { $lte: 0 };
      }
    } else if (inStock === 'true' || inStock === true) {
      query.stock = { $gt: 0 };
    }

    if (isFeatured === 'true' || isFeatured === true) {
      query.isFeatured = true;
    }

    if (isBestSeller === 'true' || isBestSeller === true) {
      query.isBestSeller = true;
    }

    if (isNewArrival === 'true' || isNewArrival === true) {
      query.isNewArrival = true;
    }

    if (discount === 'true' || discount === true) {
      query.discountPrice = { $gt: 0 };
    } else if (discount && String(discount).toLowerCase() !== 'all') {
      const discountVal = String(discount).toLowerCase();
      if (discountVal === 'onsale') {
        query.discountPrice = { $gt: 0 };
      } else if (discountVal === 'none') {
        query.discountPrice = { $lte: 0 };
      } else {
        const discountThresholds = {
          '10+': 10,
          '10': 10,
          '10percent': 10,
          '20+': 20,
          '30+': 30,
          '50+': 50,
        };
        const threshold = discountThresholds[discountVal];
        if (threshold) {
          query.discountPrice = { $gt: 0 };
          query.$expr = {
            $gte: [
              {
                $multiply: [
                  {
                    $divide: [
                      { $subtract: ['$price', '$discountPrice'] },
                      '$price',
                    ],
                  },
                  100,
                ],
              },
              threshold,
            ],
          };
        }
      }
    }

    let productsQuery = Product.find(query);

    if (fields) {
      const fieldList = String(fields).split(',').map((f) => f.trim()).filter(Boolean);
      productsQuery = productsQuery.select(fieldList.join(' '));
    } else {
      productsQuery = productsQuery.select('-description');
    }

    const validSortFields = [
      'price',
      '-price',
      'name',
      '-name',
      'rating',
      '-rating',
      'createdAt',
      '-createdAt',
      '_id',
      '-_id',
      'discountPrice',
      '-discountPrice',
      'recommended',
    ];

    if (sort === 'recommended') {
      productsQuery = productsQuery.sort({ isFeatured: -1, isBestSeller: -1, rating: -1, createdAt: -1 });
    } else if (validSortFields.includes(sort)) {
      productsQuery = productsQuery.sort(sort);
    } else {
      productsQuery = productsQuery.sort({ createdAt: -1 });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    productsQuery = productsQuery.skip(skip).limit(limitNum);

    const products = await productsQuery.exec();
    const normalizedProducts = products.map(normalizeProductImages);

    const total = await Product.countDocuments(query);

    res.status(200).json({
      success: true,
      count: normalizedProducts.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: normalizedProducts,
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products',
    });
  }
};

exports.getProduct = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID',
      });
    }

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    if (req.user) {
      try {
        const existingIndex = req.user.recentlyViewed.findIndex(
          (item) => item.product.toString() === product._id.toString()
        );

        if (existingIndex > -1) {
          req.user.recentlyViewed.splice(existingIndex, 1);
        }

        req.user.recentlyViewed.unshift({
          product: product._id,
          viewedAt: new Date(),
        });

        if (req.user.recentlyViewed.length > 20) {
          req.user.recentlyViewed = req.user.recentlyViewed.slice(0, 20);
        }

        await User.findByIdAndUpdate(req.user._id, {
          $set: { recentlyViewed: req.user.recentlyViewed },
        });
      } catch (trackErr) {
        console.error('Recently viewed tracking error:', trackErr);
      }
    }

    res.status(200).json({
      success: true,
      data: normalizeProductImages(product),
    });
  } catch (error) {
    console.error('Get product error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID',
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to fetch product',
    });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    console.log('[Product Update] Incoming multipart payload', {
      productId: req.params.id,
      bodyKeys: Object.keys(req.body || {}),
      fileCount: Array.isArray(req.files) ? req.files.length : 0,
      files: Array.isArray(req.files)
        ? req.files.map((file) => ({
            fieldname: file.fieldname,
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            path: file.path,
          }))
        : [],
    });

    const {
      name,
      sku: manualSku,
      description,
      price,
      discountPrice,
      stock,
      category,
      subcategory,
      jewelleryCollection,
      metal,
      purity,
      weight,
      diamondWeight,
      diamondShape,
      diamondClarity,
      diamondColor,
      imageUrls,
      productVideoUrl,
      productVideoThumbnail,
      tags,
      status,
      isFeatured,
      isBestSeller,
      isNewArrival,
      reservedStock,
      minimumStock,
      availableWeight,
      occasion,
    } = req.body;

    let product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    if (manualSku && manualSku.trim() && manualSku.trim() !== product.sku) {
      const existingProduct = await Product.findOne({
        sku: manualSku.trim(),
        _id: { $ne: product._id },
      });
      if (existingProduct) {
        return res.status(400).json({
          success: false,
          message: 'A product with this SKU already exists',
        });
      }
    }

    if (jewelleryCollection && jewelleryCollection !== '' && !VALID_COLLECTIONS.includes(jewelleryCollection)) {
      return res.status(400).json({
        success: false,
        message: `Invalid collection. Valid values: ${VALID_COLLECTIONS.join(', ')}`,
      });
    }

    if (occasion !== undefined && occasion !== null && occasion !== '' && !VALID_OCCASIONS.includes(occasion)) {
      return res.status(400).json({
        success: false,
        message: `Invalid occasion. Valid values: ${VALID_OCCASIONS.join(', ')}`,
      });
    }

    const priceNum = price !== undefined && price !== '' ? parseFloat(price) : null;
    const discountPriceNum = discountPrice !== undefined && discountPrice !== '' ? parseFloat(discountPrice) : null;
    const effectivePrice = priceNum !== null ? priceNum : product.price;

    if (discountPriceNum !== null) {
      if (discountPriceNum < 0) {
        return res.status(400).json({
          success: false,
          message: 'Discount price cannot be negative',
        });
      }
      if (discountPriceNum >= effectivePrice) {
        return res.status(400).json({
          success: false,
          message: 'Discount price must be less than the regular price',
        });
      }
    }

    if (priceNum !== null && priceNum < 0) {
      return res.status(400).json({
        success: false,
        message: 'Price cannot be negative',
      });
    }

    const oldImageUrls = [...(product.images || [])];
    const oldPrimaryImage = product.primaryImage || null;

    const driveFiles = await uploadRequestFilesToGoogleDrive(req, { makePublic: true });
    const uploadedFiles = driveFiles.map((file) => file.viewUrl || file.url);
    console.log('[Product Update] Drive upload result', {
      productId: req.params.id,
      uploadedCount: driveFiles.length,
      uploadedFiles,
    });

    let newImageUrls = [];
    if (req.body.imageUrls !== undefined) {
      if (typeof imageUrls === 'string') {
        try {
          newImageUrls = JSON.parse(imageUrls);
        } catch {
          if (imageUrls.trim()) {
            newImageUrls = imageUrls.split(',').map((u) => u.trim()).filter(Boolean);
          }
        }
      } else if (Array.isArray(imageUrls)) {
        newImageUrls = imageUrls.map(extractImageUrl);
      }
      newImageUrls = newImageUrls.map(extractImageUrl);
    } else {
      newImageUrls = (product.images || []).map(extractImageUrl);
    }

    const normalizedNewImageUrls = newImageUrls.map(normalizeGoogleDriveUrl);
    let images = normalizedNewImageUrls;
    if (uploadedFiles.length > 0) {
      images = [...images, ...uploadedFiles];
    }

    if (!images || images.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one product image is required',
      });
    }

    let parsedTags = tags;
    if (typeof tags === 'string') {
      parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t);
    }

    product.name = name ? name.trim() : product.name;
    if (manualSku && manualSku.trim()) {
      product.sku = manualSku.trim();
    }
    if (description !== undefined && description !== null) product.description = description;
    if (price !== undefined && price !== '' && price !== null) product.price = parseFloat(price);
    if (discountPrice !== undefined && discountPrice !== '') {
      product.discountPrice = parseFloat(discountPrice);
    } else if (discountPrice === '' || discountPrice === undefined || discountPrice === null) {
      product.discountPrice = 0;
    }
    if (stock !== undefined && stock !== '' && stock !== null) product.stock = parseInt(stock, 10);
    if (category) product.category = category;
    if (subcategory) product.subcategory = subcategory;
    if (jewelleryCollection) product.jewelleryCollection = jewelleryCollection;
    if (occasion !== undefined && occasion !== null && occasion !== '') product.occasion = occasion;
    if (metal) product.metal = metal;
    if (purity) product.purity = purity;
    if (weight) product.weight = weight;
    if (diamondWeight) product.diamondWeight = diamondWeight;
    if (diamondShape) product.diamondShape = diamondShape;
    if (diamondClarity) product.diamondClarity = diamondClarity;
    if (diamondColor) product.diamondColor = diamondColor;
    if (reservedStock !== undefined && reservedStock !== '') product.reservedStock = parseInt(reservedStock, 10);
    if (minimumStock !== undefined && minimumStock !== '') product.minimumStock = parseInt(minimumStock, 10);
    if (availableWeight !== undefined && availableWeight !== '') product.availableWeight = availableWeight;
    if (newImageUrls.length > 0 || uploadedFiles.length > 0) {
      const imagesSet = new Set(images.map(normalizeGoogleDriveUrl));
      const removableUrls = oldImageUrls.filter(
        (url) => url && !imagesSet.has(normalizeGoogleDriveUrl(extractImageUrl(url)))
      );

      if (removableUrls.length > 0) {
        await deleteDriveFilesForUrls({
          userId: req.user._id,
          urls: removableUrls.map(extractImageUrl),
        });
      }

      product.images = images;
      product.primaryImage = extractImageUrl(images[0]);
    }
    if (parsedTags) product.tags = parsedTags;
    if (status) product.status = status;
    product.isFeatured =
      isFeatured === true || isFeatured === 'true' || isFeatured === 1;
    product.isBestSeller =
      isBestSeller === true || isBestSeller === 'true' || isBestSeller === 1;
    product.isNewArrival =
      isNewArrival === true || isNewArrival === 'true' || isNewArrival === 1;
    if (productVideoUrl !== undefined) product.productVideoUrl = productVideoUrl;
    if (productVideoThumbnail !== undefined) product.productVideoThumbnail = productVideoThumbnail;

    await product.save();
    const responseProduct = normalizeProductImages(product);
    console.log('[Product Update] Saved product image urls', {
      productId: responseProduct._id,
      images: responseProduct.images,
      primaryImage: responseProduct.primaryImage,
    });

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: responseProduct,
    });
  } catch (error) {
    console.error('Update product error:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', '),
      });
    }
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A product with this SKU already exists',
      });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update product',
    });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    const driveUrls = (product.images || []).map(extractImageUrl);
    await deleteDriveFilesForUrls({
      userId: req.user._id,
      urls: driveUrls,
    });
    await product.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully',
    });
  } catch (error) {
    console.error('Delete product error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID',
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to delete product',
    });
  }
};

const DEFAULT_PRODUCTS = [
  {
    name: 'Eternal Diamond Solitaire Ring',
    description: 'A timeless solitaire ring featuring a brilliant-cut diamond set in 14K white gold.',
    price: 24999,
    discountPrice: 21999,
    stock: 25,
    category: 'Rings',
    subcategory: 'Engagement Rings',
    jewelleryCollection: 'Eternal',
    metal: 'White Gold',
    purity: '14K',
    weight: '2.5g',
    diamondWeight: '1.0ct',
    diamondShape: 'Round',
    diamondClarity: 'VS1',
    diamondColor: 'G',
    images: ['https://placehold.co/600x600?text=Diamond+Ring+1', 'https://placehold.co/600x600?text=Diamond+Ring+2'],
    tags: ['engagement', 'solitaire', 'diamond', 'white-gold'],
    occasion: 'Engagement',
    isFeatured: true,
    isBestSeller: true,
    isNewArrival: false,
    rating: 4.8,
    reviews: 128,
  },
  {
    name: 'Heritage Gold Bangle Set',
    description: 'Handcrafted traditional gold bangles with intricate Kundan work, perfect for special occasions.',
    price: 18999,
    stock: 40,
    category: 'Bangles',
    jewelleryCollection: 'Heritage',
    metal: 'Gold',
    purity: '22K',
    weight: '12g',
    images: ['https://placehold.co/600x600?text=Gold+Bangle+1', 'https://placehold.co/600x600?text=Gold+Bangle+2'],
    tags: ['bangles', 'heritage', 'gold', 'traditional'],
    occasion: 'Festive',
    isFeatured: true,
    isBestSeller: true,
    isNewArrival: false,
    rating: 4.7,
    reviews: 95,
  },
  {
    name: 'Blossom Diamond Pendant',
    description: 'A delicate pendant featuring a cluster of small diamonds set in rose gold, symbolizing blooming love.',
    price: 12999,
    discountPrice: 10999,
    stock: 30,
    category: 'Necklaces',
    subcategory: 'Pendant Sets',
    jewelleryCollection: 'Blossom',
    metal: 'Rose Gold',
    purity: '14K',
    weight: '1.8g',
    diamondWeight: '0.5ct',
    diamondShape: 'Round',
    diamondClarity: 'VS2',
    diamondColor: 'H',
    images: ['https://placehold.co/600x600?text=Blossom+Pendant+1', 'https://placehold.co/600x600?text=Blossom+Pendant+2'],
    tags: ['pendant', 'blossom', 'rose-gold', 'diamond'],
    occasion: 'Anniversary',
    isFeatured: false,
    isBestSeller: false,
    isNewArrival: true,
    rating: 4.6,
    reviews: 64,
  },
  {
    name: 'Celeste Sapphire Drop Earrings',
    description: 'Elegant drop earrings featuring cushion-cut sapphires accented with diamonds in 18K gold.',
    price: 15999,
    stock: 20,
    category: 'Earrings',
    subcategory: 'Diamond Earrings',
    jewelleryCollection: 'Celeste',
    metal: 'Gold',
    purity: '18K',
    weight: '3.2g',
    diamondWeight: '0.75ct',
    diamondShape: 'Cushion',
    diamondClarity: 'SI1',
    diamondColor: 'I',
    images: ['https://placehold.co/600x600?text=Sapphire+Earrings+1', 'https://placehold.co/600x600?text=Sapphire+Earrings+2'],
    tags: ['earrings', 'sapphire', 'celeste', 'gold'],
    occasion: 'Party',
    isFeatured: false,
    isBestSeller: true,
    isNewArrival: false,
    rating: 4.9,
    reviews: 87,
  },
  {
    name: 'Aura Gold Chain Bracelet',
    description: 'A versatile gold chain bracelet with a secure lobster clasp, suitable for any occasion.',
    price: 8999,
    stock: 50,
    category: 'Bracelets',
    subcategory: 'Chain Bracelets',
    jewelleryCollection: 'Aura',
    metal: 'Gold',
    purity: '14K',
    weight: '4.5g',
    images: ['https://placehold.co/600x600?text=Gold+Bracelet+1', 'https://placehold.co/600x600?text=Gold+Bracelet+2'],
    tags: ['bracelet', 'chain', 'aura', 'gold'],
    occasion: 'Everyday',
    isFeatured: false,
    isBestSeller: false,
    isNewArrival: false,
    rating: 4.3,
    reviews: 42,
  },
  {
    name: 'Eternal Three-Stone Engagement Ring',
    description: 'A classic three-stone diamond ring representing past, present, and future in 18K white gold.',
    price: 34999,
    discountPrice: 29999,
    stock: 15,
    category: 'Rings',
    subcategory: 'Engagement Rings',
    jewelleryCollection: 'Eternal',
    metal: 'White Gold',
    purity: '18K',
    weight: '3.1g',
    diamondWeight: '1.5ct total',
    diamondShape: 'Round',
    diamondClarity: 'VS1',
    diamondColor: 'G',
    images: ['https://placehold.co/600x600?text=Three+Stone+Ring+1', 'https://placehold.co/600x600?text=Three+Stone+Ring+2'],
    tags: ['engagement', 'three-stone', 'diamond', 'white-gold'],
    occasion: 'Engagement',
    isFeatured: true,
    isBestSeller: false,
    isNewArrival: false,
    rating: 4.9,
    reviews: 156,
  },
  {
    name: 'Blossom Pearl Drop Earrings',
    description: 'Delicate earrings featuring cultured pearls with rose gold accents, perfect for everyday elegance.',
    price: 6999,
    stock: 35,
    category: 'Earrings',
    subcategory: 'Gold Earrings',
    jewelleryCollection: 'Blossom',
    metal: 'Rose Gold',
    purity: '14K',
    weight: '2.1g',
    images: ['https://placehold.co/600x600?text=Pearl+Earrings+1', 'https://placehold.co/600x600?text=Pearl+Earrings+2'],
    tags: ['earrings', 'blossom', 'pearl', 'rose-gold'],
    occasion: 'Gift',
    isFeatured: false,
    isBestSeller: false,
    isNewArrival: true,
    rating: 4.4,
    reviews: 78,
  },
  {
    name: 'Heritage Kundan Bangle',
    description: 'Traditional Kundan bangle with intricate stonework and heritage design, a perfect fusion of tradition and elegance.',
    price: 11999,
    discountPrice: 9999,
    stock: 18,
    category: 'Bangles',
    jewelleryCollection: 'Heritage',
    metal: 'Gold',
    purity: '22K',
    weight: '8.5g',
    images: ['https://placehold.co/600x600?text=Kundan+Bangle+1', 'https://placehold.co/600x600?text=Kundan+Bangle+2'],
    tags: ['bangles', 'kundan', 'heritage', 'traditional'],
    occasion: 'Festive',
    isFeatured: true,
    isBestSeller: true,
    isNewArrival: false,
    rating: 4.6,
    reviews: 112,
  },
  {
    name: 'Bridal Diamond Necklace Set',
    description: 'A stunning bridal necklace set with diamonds and pearls, perfect for the wedding day.',
    price: 45999,
    discountPrice: 39999,
    stock: 8,
    category: 'Necklaces',
    subcategory: 'Pendant Sets',
    jewelleryCollection: 'Bridal',
    metal: 'Gold',
    purity: '18K',
    weight: '15g',
    diamondWeight: '2.0ct total',
    diamondShape: 'Round',
    diamondClarity: 'VS1',
    diamondColor: 'G',
    images: ['https://placehold.co/600x600?text=Bridal+Necklace+1', 'https://placehold.co/600x600?text=Bridal+Necklace+2'],
    tags: ['bridal', 'wedding', 'necklace', 'diamond', 'pearls'],
    occasion: 'Bridal',
    isFeatured: true,
    isBestSeller: false,
    isNewArrival: false,
    rating: 4.9,
    reviews: 56,
  },
  {
    name: 'Wedding Band Set for Groom',
    description: 'Classic wedding bands for him and her, crafted in polished 14K gold.',
    price: 15999,
    stock: 30,
    category: 'Rings',
    subcategory: 'Wedding Bands',
    jewelleryCollection: 'Wedding',
    metal: 'Gold',
    purity: '14K',
    weight: '4g',
    images: ['https://placehold.co/600x600?text=Wedding+Band+1', 'https://placehold.co/600x600?text=Wedding+Band+2'],
    tags: ['wedding', 'bands', 'gold', 'couple'],
    occasion: 'Wedding',
    isFeatured: false,
    isBestSeller: true,
    isNewArrival: false,
    rating: 4.7,
    reviews: 89,
  },
  {
    name: 'Occasion Gold Jhumkas',
    description: 'Traditional gold jhumkas perfect for festivals and special occasions.',
    price: 7999,
    stock: 25,
    category: 'Earrings',
    subcategory: 'Gold Earrings',
    jewelleryCollection: 'Occasion',
    metal: 'Gold',
    purity: '22K',
    weight: '6g',
    images: ['https://placehold.co/600x600?text=Jhumkas+1', 'https://placehold.co/600x600?text=Jhumkas+2'],
    tags: ['earrings', 'jhumkas', 'occasion', 'gold', 'festive'],
    occasion: 'Festive',
    isFeatured: false,
    isBestSeller: false,
    isNewArrival: true,
    rating: 4.5,
    reviews: 34,
  },
];

exports.seedProducts = async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  try {
    await Product.deleteMany({});
    const created = await Product.insertMany(DEFAULT_PRODUCTS);
    res.status(201).json({
      success: true,
      message: `Seeded ${created.length} products`,
      count: created.length,
    });
  } catch (error) {
    console.error('Seed products error:', error);
    res.status(500).json({ success: false, message: 'Failed to seed products' });
  }
};

exports.getRelatedProducts = asyncHandler(async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID',
      });
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 8));

    const relatedProducts = await Product.find({
      _id: { $ne: product._id },
      status: 'active',
      $or: [
        { category: product.category },
        ...(product.subcategory ? [{ subcategory: product.subcategory }] : []),
        ...(product.jewelleryCollection
          ? [{ jewelleryCollection: product.jewelleryCollection }]
          : []),
        ...(product.metal ? [{ metal: product.metal }] : []),
      ],
    })
      .sort({ rating: -1, createdAt: -1 })
      .limit(limit);

    const normalized = relatedProducts.map(normalizeProductImages);

    res.status(200).json({
      success: true,
      count: normalized.length,
      data: normalized,
    });
  } catch (error) {
    console.error('Get related products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch related products',
    });
  }
});

exports.getRecentlyViewed = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('recentlyViewed');

    if (!user || !user.recentlyViewed || user.recentlyViewed.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
      });
    }

    const productIds = user.recentlyViewed.map((item) => item.product);

    let products = await Product.find({
      _id: { $in: productIds },
    }).select('-description');

    const viewedMap = {};
    user.recentlyViewed.forEach((item) => {
      viewedMap[item.product.toString()] = item.viewedAt;
    });

    products = products.sort((a, b) => {
      const aTime = viewedMap[a._id.toString()] || a.createdAt;
      const bTime = viewedMap[b._id.toString()] || b.createdAt;
      return new Date(bTime) - new Date(aTime);
    });

    await User.findByIdAndUpdate(req.user._id, {
      $pull: {
        recentlyViewed: {
          product: { $nin: products.map((p) => p._id) },
        },
      },
    });

    const normalized = products.map(normalizeProductImages);

    res.status(200).json({
      success: true,
      count: normalized.length,
      data: normalized,
    });
  } catch (error) {
    console.error('Get recently viewed error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recently viewed products',
    });
  }
});

