const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

const VALID_ORDER_STATUSES = [
  'RECEIVED',
  'CLEANING',
  'DASHBOARD',
  'QA_CHECK',
  'DELIVERED',
];

app.use(cors());
app.use(express.json());

// 1. Health check route
app.get('/', (req, res) => {
  res.json({ status: 'active', service: 'CleanSheet.ng API' });
});

// 2. Create a new order when a user checks out
app.post('/api/orders', async (req, res) => {
  try {
    const rawEmail = req.body.email || req.body.customerEmail;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    const orderReference =
      typeof req.body.orderReference === 'string' ? req.body.orderReference.trim() : '';
    const fileName = typeof req.body.fileName === 'string' ? req.body.fileName.trim() : '';
    const planType = typeof req.body.planType === 'string' ? req.body.planType.trim() : '';
    const fileSize = Number(req.body.fileSize);
    const amountNaira = Number(req.body.amountNaira);
    const isRush = Boolean(req.body.isRush);

    if (!email || !orderReference || !fileName || !planType) {
      return res.status(400).json({
        success: false,
        error: 'email, orderReference, fileName, and planType are required',
      });
    }

    if (!Number.isInteger(fileSize) || fileSize < 0 || !Number.isInteger(amountNaira) || amountNaira < 0) {
      return res.status(400).json({
        success: false,
        error: 'fileSize and amountNaira must be valid non-negative integers',
      });
    }

    // Ensure customer exists or create them
    const customer = await prisma.customer.upsert({
      where: { email },
      update: {},
      create: { email },
    });

    // Calculate deadline (48 hours standard, or 12 hours if rush)
    const hoursToAdd = isRush ? 12 : 48;
    const deadlineAt = new Date(Date.now() + hoursToAdd * 60 * 60 * 1000);

    // Create the order
    const order = await prisma.order.create({
      data: {
        orderReference,
        customerEmail: customer.email,
        fileName,
        fileSize,
        planType,
        amountNaira,
        isRush,
        deadlineAt,
      },
    });

    return res.status(201).json({ success: true, order });
  } catch (error) {
    console.error('Error creating order:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: 'An order with this orderReference already exists',
      });
    }

    if (error.code === 'P2000' || error.code === 'P2025') {
      return res.status(400).json({
        success: false,
        error: 'Invalid data provided for order creation',
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to create order',
      details: error.message,
    });
  }
});

// 3. Get all orders for your operator console
app.get('/api/operator/orders', async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ success: true, orders });
  } catch (error) {
    console.error('Error fetching orders:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch orders',
      details: error.message,
    });
  }
});

// 4. Update order status and optional changeLog from the operator console
app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    const rawStatus =
      typeof req.body.status === 'string' ? req.body.status.trim().toUpperCase() : '';
    const hasChangeLog = Object.prototype.hasOwnProperty.call(req.body, 'changeLog');
    const changeLog =
      hasChangeLog && req.body.changeLog !== null ? String(req.body.changeLog).trim() : undefined;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Order id is required',
      });
    }

    if (!VALID_ORDER_STATUSES.includes(rawStatus)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Allowed values: ${VALID_ORDER_STATUSES.join(', ')}`,
      });
    }

    const data = {
      status: rawStatus,
    };

    if (hasChangeLog) {
      data.changeLog = changeLog || null;
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data,
    });

    return res.json({ success: true, order: updatedOrder });
  } catch (error) {
    console.error('Error updating order status:', error);

    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to update order status',
      details: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`CleanSheet.ng backend running on http://localhost:${PORT}`);
});