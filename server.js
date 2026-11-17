const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 1. Health check route
app.get('/', (req, res) => {
  res.json({ status: 'active', service: 'CleanSheet.ng API' });
});

// 2. Create a new order when a user checks out
app.post('/api/orders', async (req, res) => {
  try {
    const { email, orderReference, fileName, fileSize, planType, amountNaira, isRush } = req.body;

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

    res.status(201).json({ success: true, order });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});

// 3. Get all orders for your operator console
app.get('/api/operator/orders', async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, orders });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch orders' });
  }
});

app.listen(PORT, () => {
  console.log(`CleanSheet.ng backend running on http://localhost:${PORT}`);
});