const Product = require('../models/Product');
const path = require('path');

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

    const uploadedFiles = req.files ? req.files.map((f) => `/uploads/${f.filename}`) : [];

    if (uploadedFiles.length > 0) {
      const invalidUpload = uploadedFiles.some((f) => {
        const ext = path.extname(f).toLowerCase();
        return !/\.(jpg|jpeg|png|webp|gif)$/.test(ext);
      });
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

    const images = [...imageUrls, ...uploadedFiles];

    if (images.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one product image is required (upload or URL)',
      });
    }

    let sku = manualSku ? manualSku.trim() : '';
    if (!sku) {
      const skuPrefix = generateSKU(name, category, metal);
      const skuNum = await getNextSkuNumber(skuPrefix);
      sku = `${skuPrefix}-${skuNum}`;
    } else {
      const existingProduct = await Product.findOne({ sku: sku });
      if (existingProduct) {
        return res.status(400).json({
          success: false,
          message: 'A product with this SKU already exists',
        });
      }
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

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: product,
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
    res.status(500).json({
      success: false,
      message: 'Failed to create product',
    });
  }
};

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

    const total = await Product.countDocuments(query);

    res.status(200).json({
      success: true,
      count: products.length,
      total,
      page: parseInt(page, 10),
      pages: Math.ceil(total / parseInt(limit, 10)),
      data: products,
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
      data: product,
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

    const uploadedFiles = req.files ? req.files.map((f) => `/uploads/${f.filename}`) : [];

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

    let images = newImageUrls;
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

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: product,
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
