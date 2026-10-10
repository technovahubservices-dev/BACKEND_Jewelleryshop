jest.mock('../models/Accessory', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
}));

jest.mock('../models/Product', () => ({
  countDocuments: jest.fn(),
}));

const mongoose = require('mongoose');
const Accessory = require('../models/Accessory');
const Product = require('../models/Product');
const {
  createAccessory,
  getAccessory,
  updateAccessory,
  deleteAccessory,
} = require('../controllers/accessoryController');

const createResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const runHandler = async (handler, req, res) => {
  const next = jest.fn((error) => {
    throw error;
  });

  await handler(req, res, next);
  return next;
};

describe('accessoryController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createAccessory', () => {
    it('trims the name, generates a slug, and creates an accessory', async () => {
      const created = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Bag',
        slug: 'bag',
        description: '',
        isActive: true,
      };

      Accessory.findOne.mockResolvedValue(null);
      Accessory.create.mockResolvedValue(created);

      const req = { body: { name: ' Bag ', description: '', isActive: true } };
      const res = createResponse();

      await runHandler(createAccessory, req, res);

      expect(Accessory.findOne).toHaveBeenCalledWith({
        $or: [
          { name: { $regex: '^Bag$', $options: 'i' } },
          { slug: 'bag' },
        ],
      });
      expect(Accessory.create).toHaveBeenCalledWith({
        name: 'Bag',
        slug: 'bag',
        description: '',
        isActive: true,
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Accessory created successfully',
        data: created,
      });
    });

    it('rejects duplicate names or generated slugs', async () => {
      Accessory.findOne.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

      const req = { body: { name: ' BAG ' } };
      const res = createResponse();

      await runHandler(createAccessory, req, res);

      expect(Accessory.create).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Accessory with this name already exists',
      });
    });
  });

  describe('getAccessory', () => {
    it('rejects invalid accessory IDs', async () => {
      const req = { params: { id: 'not-an-id' } };
      const res = createResponse();

      await runHandler(getAccessory, req, res);

      expect(Accessory.findById).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid accessory ID',
      });
    });
  });

  describe('updateAccessory', () => {
    it('rejects invalid accessory IDs', async () => {
      const req = { params: { id: 'not-an-id' }, body: { name: 'Bag' } };
      const res = createResponse();

      await runHandler(updateAccessory, req, res);

      expect(Accessory.findById).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid accessory ID',
      });
    });

    it('updates an existing accessory and regenerates the slug', async () => {
      const accessoryId = new mongoose.Types.ObjectId();
      const accessory = {
        _id: accessoryId,
        name: 'Bag',
        slug: 'bag',
        description: '',
        isActive: true,
        save: jest.fn().mockResolvedValue(undefined),
      };

      Accessory.findById.mockResolvedValue(accessory);
      Accessory.findOne.mockResolvedValue(null);

      const req = {
        params: { id: accessoryId.toString() },
        body: {
          name: ' Travel Bag ',
          description: 'Carry jewellery safely',
          isActive: false,
        },
      };
      const res = createResponse();

      await runHandler(updateAccessory, req, res);

      expect(Accessory.findOne).toHaveBeenCalledWith({
        $or: [
          { name: { $regex: '^Travel Bag$', $options: 'i' } },
          { slug: 'travel-bag' },
        ],
        _id: { $ne: accessoryId },
      });
      expect(accessory.name).toBe('Travel Bag');
      expect(accessory.slug).toBe('travel-bag');
      expect(accessory.description).toBe('Carry jewellery safely');
      expect(accessory.isActive).toBe(false);
      expect(accessory.save).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 404 when the accessory does not exist', async () => {
      const accessoryId = new mongoose.Types.ObjectId();
      Accessory.findById.mockResolvedValue(null);

      const req = { params: { id: accessoryId.toString() }, body: { name: 'Bag' } };
      const res = createResponse();

      await runHandler(updateAccessory, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Accessory not found',
      });
    });
  });

  describe('deleteAccessory', () => {
    it('rejects invalid accessory IDs', async () => {
      const req = { params: { id: 'not-an-id' } };
      const res = createResponse();

      await runHandler(deleteAccessory, req, res);

      expect(Accessory.findById).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid accessory ID',
      });
    });

    it('returns 404 when the accessory does not exist', async () => {
      const accessoryId = new mongoose.Types.ObjectId();
      Accessory.findById.mockResolvedValue(null);

      const req = { params: { id: accessoryId.toString() } };
      const res = createResponse();

      await runHandler(deleteAccessory, req, res);

      expect(Product.countDocuments).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Accessory not found',
      });
    });

    it('does not delete accessories currently used by products', async () => {
      const accessoryId = new mongoose.Types.ObjectId();
      const accessory = {
        _id: accessoryId,
        name: 'Bag',
        deleteOne: jest.fn(),
      };

      Accessory.findById.mockResolvedValue(accessory);
      Product.countDocuments.mockResolvedValue(2);

      const req = { params: { id: accessoryId.toString() } };
      const res = createResponse();

      await runHandler(deleteAccessory, req, res);

      expect(Product.countDocuments).toHaveBeenCalledWith({ subcategory: 'Bag' });
      expect(accessory.deleteOne).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'This accessory is currently used by 2 product(s) and cannot be deleted.',
      });
    });

    it('deletes an unreferenced accessory', async () => {
      const accessoryId = new mongoose.Types.ObjectId();
      const accessory = {
        _id: accessoryId,
        name: 'Bag',
        deleteOne: jest.fn().mockResolvedValue(undefined),
      };

      Accessory.findById.mockResolvedValue(accessory);
      Product.countDocuments.mockResolvedValue(0);

      const req = { params: { id: accessoryId.toString() } };
      const res = createResponse();

      await runHandler(deleteAccessory, req, res);

      expect(accessory.deleteOne).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Accessory deleted successfully',
      });
    });
  });
});
