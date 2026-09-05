const Product = require('../models/Product');
const asyncHandler = require('express-async-handler');
const {
  deleteDriveFilesForUrls,
  normalizeGoogleDriveUrl,
  uploadRequestFilesToGoogleDrive,
} = require('../utils/googleDriveStorage');

const normalizeProductImages = (product) => {
  const plainProduct = typeof product?.toObject === 'function'
    ? product.toObject()
    : { ...product };

  if (!plainProduct) {
    return plainProduct;
  }

  if (Array.isArray(plainProduct.images)) {
    plainProduct.images = plainProduct.images.map(normalizeGoogleDriveUrl);
  }

  if (plainProduct.primaryImage) {
    plainProduct.primaryImage = normalizeGoogleDriveUrl(plainProduct.primaryImage);
  }

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
  const lastProduct = await Product.findOne({
    sku: regex,
  }).sort({ createdAt: -1 });

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
      tags,
      status,
      isFeatured,
      isBestSeller,
      isNewArrival,
      reservedStock,
      minimumStock,
      availableWeight,
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
      const invalidUrl = imageUrls.some((url) => {
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

    const normalizedImageUrls = imageUrls.map(normalizeGoogleDriveUrl);
    const images = [...normalizedImageUrls, ...uploadedFiles];

    if (images.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one product image is required (upload or URL)',
      });
    }

    if (!sku) {
      const skuPrefix = generateSKU(name, category, metal);
      const skuNum = await getNextSkuNumber(skuPrefix);
      sku = `${skuPrefix}-${skuNum}`;
    }

    let parsedTags = tags;
    if (typeof tags === 'string') {
      parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t);
    }

    const primaryImage = images[0];

    const productData = {
      name: name.trim(),
      sku,
      category,
      description: description || undefined,
      images,
      primaryImage,
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

exports.getProducts = async (req, res) => {
  try {
    const { search, category, status, sort, page = 1, limit = 20 } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    if (category) {
      const trimmedCategory = String(category).trim();
      if (trimmedCategory) {
        const escaped = trimmedCategory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.category = { $regex: new RegExp(`^${escaped}$`, 'i') };
      }
    }

    if (status) {
      query.status = status;
    }

    let productsQuery = Product.find(query);

    if (sort) {
      const sortBy = sort.startsWith('-') ? sort.substring(1) : sort;
      const sortOrder = sort.startsWith('-') ? -1 : 1;
      productsQuery = productsQuery.sort({ [sortBy]: sortOrder });
    } else {
      productsQuery = productsQuery.sort({ createdAt: -1 });
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    productsQuery = productsQuery.skip(skip).limit(parseInt(limit, 10));

    const products = await productsQuery.exec();
    const normalizedProducts = products.map(normalizeProductImages);

    const total = await Product.countDocuments(query);

    res.status(200).json({
      success: true,
      count: normalizedProducts.length,
      total,
      page: parseInt(page, 10),
      pages: Math.ceil(total / parseInt(limit, 10)),
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
    const product = await Product.findById(req.params.id);

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
      tags,
      status,
      isFeatured,
      isBestSeller,
      isNewArrival,
      reservedStock,
      minimumStock,
      availableWeight,
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
        newImageUrls = imageUrls;
      }
    } else {
      newImageUrls = [...(product.images || [])];
    }

    const normalizedNewImageUrls = newImageUrls.map(normalizeGoogleDriveUrl);
    let images = normalizedNewImageUrls;
    if (uploadedFiles.length > 0) {
      images = [...images, ...uploadedFiles];
    }
    images = images.map(normalizeGoogleDriveUrl);

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
        (url) => url && !imagesSet.has(normalizeGoogleDriveUrl(url))
      );

      if (removableUrls.length > 0) {
        await deleteDriveFilesForUrls({
          userId: req.user._id,
          urls: removableUrls,
        });
      }

      product.images = images;
      product.primaryImage = images[0];
    }
    if (parsedTags) product.tags = parsedTags;
    if (status) product.status = status;
    product.isFeatured =
      isFeatured === true || isFeatured === 'true' || isFeatured === 1;
    product.isBestSeller =
      isBestSeller === true || isBestSeller === 'true' || isBestSeller === 1;
    product.isNewArrival =
      isNewArrival === true || isNewArrival === 'true' || isNewArrival === 1;

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

    await deleteDriveFilesForUrls({
      userId: req.user._id,
      urls: product.images || [],
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
    isFeatured: true,
    isBestSeller: true,
    isNewArrival: false,
    rating: 4.6,
    reviews: 112,
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
