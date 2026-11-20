const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Only these fields are ever sent back to the public website
const PUBLIC_ORDER_FIELDS = {
  orderReference: true,
  fileName: true,
  planType: true,
  amountNaira: true,
  isRush: true,
  status: true,
  deadlineAt: true,
  changeLog: true,
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Protects operator-only routes. Set OPERATOR_KEY in Render's Environment tab.
function requireOperator(req, res, next) {
  if (!process.env.OPERATOR_KEY || req.headers['x-api-key'] !== process.env.OPERATOR_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

// 1. Health check route
app.get('/', (req, res) => {
  res.json({ status: 'active', service: 'CleanSheet.ng API' });
});

// 2. Create an order AFTER Paystack payment is verified
app.post('/api/orders', async (req, res) => {
  try {
    const { email, orderReference, fileName, fileSize, planType, isRush } = req.body;

    // Validate input
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(cleanEmail) || !orderReference || !fileName || !planType) {
      return res.status(400).json({ success: false, error: 'Missing or invalid fields' });
    }

    // If this payment was already saved (for example the browser retried), return it
    const existing = await prisma.order.findUnique({
      where: { orderReference },
      select: PUBLIC_ORDER_FIELDS,
    });
    if (existing) {
      return res.status(200).json({ success: true, order: existing });
    }

    // Verify the payment with Paystack (secret key stays on the server only)
    if (!process.env.PAYSTACK_SECRET_KEY) {
      console.error('PAYSTACK_SECRET_KEY is not set');
      return res.status(500).json({ success: false, error: 'Server payment setup is incomplete' });
    }

    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(orderReference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const verify = await verifyRes.json();

    if (!verify.status || !verify.data || verify.data.status !== 'success') {
      return res.status(402).json({ success: false, error: 'Payment not verified' });
    }

    // Use the amount Paystack actually charged, not the amount sent by the browser
    const verifiedAmountNaira = Math.round(verify.data.amount / 100);

    // Make sure the payer email matches the email on the order
    const paidEmail = String(verify.data.customer?.email || '').toLowerCase();
    if (paidEmail && paidEmail !== cleanEmail) {
      return res.status(400).json({ success: false, error: 'Email does not match payment' });
    }

    // Ensure customer exists or create them
    const customer = await prisma.customer.upsert({
      where: { email: cleanEmail },
      update: {},
      create: { email: cleanEmail },
    });

    // Calculate deadline (48 hours standard, or 12 hours if rush)
    const rush = Boolean(isRush);
    const hoursToAdd = rush ? 12 : 48;
    const deadlineAt = new Date(Date.now() + hoursToAdd * 60 * 60 * 1000);

    // Create the order
    const order = await prisma.order.create({
      data: {
        orderReference,
        customerEmail: customer.email,
        fileName: String(fileName),
        fileSize: Math.round(Number(fileSize)) || 0,
        planType: String(planType),
        amountNaira: verifiedAmountNaira,
        isRush: rush,
        deadlineAt,
      },
      select: PUBLIC_ORDER_FIELDS,
    });

    res.status(201).json({ success: true, order });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});

// 3. Public order tracker: returns ONE order, by reference, with no email
app.get('/api/orders/:reference', async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { orderReference: req.params.reference },
      select: PUBLIC_ORDER_FIELDS,
    });
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    res.json({ success: true, order });
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch order' });
  }
});

// 4. All orders for your operator console (protected with x-api-key header)
app.get('/api/operator/orders', requireOperator, async (req, res) => {
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
  console.log(`CleanSheet.ng backend running on port ${PORT}`);
});
