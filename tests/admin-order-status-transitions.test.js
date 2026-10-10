const mongoose = require('mongoose');

jest.mock('../services/mailer', () => ({
  sendOrderStatusNotificationEmail: jest.fn().mockResolvedValue({ delivered: true }),
}));

const Order = require('../models/Order');
const { sendOrderStatusNotificationEmail } = require('../services/mailer');
const { adminUpdateOrderStatus } = require('../controllers/adminOrderController');

const orderId = new mongoose.Types.ObjectId().toString();
const adminId = new mongoose.Types.ObjectId();

const createOrder = (overrides = {}) => {
  const order = {
    _id: orderId,
    orderNumber: 'ORD-TEST-000001',
    invoiceNumber: 'INV-TEST-000001',
    user: null,
    items: [],
    status: 'new',
    paymentStatus: 'pending',
    shippingStatus: 'not_shipped',
    statusHistory: [],
    save: jest.fn(),
    ...overrides,
  };
  order.save.mockResolvedValue(order);
  return order;
};

const mockFindOrder = (order) => {
  jest.spyOn(Order, 'findById').mockReturnValue({
    populate: jest.fn().mockResolvedValue(order),
  });
};

const callUpdate = async (order, body) => {
  mockFindOrder(order);
  const req = {
    params: { id: orderId },
    body,
    user: { _id: adminId },
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const next = jest.fn();

  await adminUpdateOrderStatus(req, res, next);

  return { res, next };
};

describe('Admin order status transitions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    sendOrderStatusNotificationEmail.mockClear();
  });

  it.each([
    ['new', 'confirmed'],
    ['confirmed', 'payment_received'],
    ['payment_received', 'processing'],
    ['processing', 'manufacturing'],
    ['manufacturing', 'quality_check'],
    ['quality_check', 'packed'],
    ['packed', 'shipped'],
    ['shipped', 'delivered'],
  ])('allows %s -> %s', async (fromStatus, toStatus) => {
    const order = createOrder({ status: fromStatus });
    const { res } = await callUpdate(order, { status: ` ${toStatus} `, note: 'Status update' });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(order.status).toBe(toStatus);
    expect(order.statusHistory).toHaveLength(1);
    expect(order.statusHistory[0]).toMatchObject({
      status: toStatus,
      note: 'Status update',
      updatedBy: adminId,
    });
    expect(order.save).toHaveBeenCalledTimes(1);
    expect(sendOrderStatusNotificationEmail).toHaveBeenCalledWith(order, toStatus);
  });

  it.each([
    'new',
    'confirmed',
    'payment_received',
    'processing',
    'manufacturing',
    'quality_check',
    'packed',
    'shipped',
  ])('allows cancellation from %s', async (fromStatus) => {
    const order = createOrder({ status: fromStatus, shippingStatus: 'shipped' });
    const { res } = await callUpdate(order, { status: 'cancelled' });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(order.status).toBe('cancelled');
    expect(order.shippingStatus).toBe('not_shipped');
    expect(sendOrderStatusNotificationEmail).toHaveBeenCalledWith(order, 'cancelled');
  });

  it.each([
    ['new', 'delivered'],
    ['confirmed', 'shipped'],
    ['delivered', 'processing'],
    ['cancelled', 'confirmed'],
  ])('rejects invalid %s -> %s transition', async (fromStatus, toStatus) => {
    const order = createOrder({ status: fromStatus });
    const { res } = await callUpdate(order, { status: toStatus });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: `Invalid status transition from "${fromStatus}" to "${toStatus}"`,
    }));
    expect(order.status).toBe(fromStatus);
    expect(order.save).not.toHaveBeenCalled();
    expect(sendOrderStatusNotificationEmail).not.toHaveBeenCalled();
  });

  it('keeps shipping synchronized when status becomes shipped', async () => {
    const order = createOrder({ status: 'packed', shippingStatus: 'ready_to_ship' });
    const { res } = await callUpdate(order, {
      status: 'shipped',
      shippingStatus: 'ready_to_ship',
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(order.status).toBe('shipped');
    expect(order.shippingStatus).toBe('shipped');
    expect(order.shippedAt).toBeInstanceOf(Date);
  });

  it('keeps shipping synchronized when status becomes delivered', async () => {
    const order = createOrder({ status: 'shipped', shippingStatus: 'shipped' });
    const { res } = await callUpdate(order, {
      status: 'delivered',
      shippingStatus: 'not_shipped',
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(order.status).toBe('delivered');
    expect(order.shippingStatus).toBe('delivered');
    expect(order.deliveredAt).toBeInstanceOf(Date);
    expect(order.isDelivered).toBe(true);
  });

  it('rejects contradictory shipping-only updates for synchronized statuses', async () => {
    const order = createOrder({ status: 'delivered', shippingStatus: 'delivered' });
    const { res } = await callUpdate(order, { shippingStatus: 'not_shipped' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(order.shippingStatus).toBe('delivered');
    expect(order.save).not.toHaveBeenCalled();
  });

  it('updates payment status independently without status email', async () => {
    const order = createOrder({ status: 'confirmed', paymentStatus: 'pending' });
    const { res } = await callUpdate(order, { paymentStatus: ' paid ' });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(order.status).toBe('confirmed');
    expect(order.paymentStatus).toBe('paid');
    expect(order.statusHistory).toHaveLength(0);
    expect(sendOrderStatusNotificationEmail).not.toHaveBeenCalled();
  });

  it('does not create duplicate status history when status is unchanged without note', async () => {
    const order = createOrder({ status: 'confirmed', statusHistory: [] });
    const { res } = await callUpdate(order, { status: 'confirmed' });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(order.statusHistory).toHaveLength(0);
    expect(sendOrderStatusNotificationEmail).not.toHaveBeenCalled();
  });
});
