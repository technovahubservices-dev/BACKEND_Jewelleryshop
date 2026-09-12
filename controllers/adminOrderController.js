const PDFDocument = require('pdfkit');
const https = require('https');
const http = require('http');

const StoreSetting = require('../models/StoreSetting');
const HomepageSetting = require('../models/HomepageSetting');

const {
  normalizeGoogleDriveUrl,
  getGoogleDriveFileId,
  buildPublicDriveImageUrl,
} = require('../utils/googleDriveStorage');

// =========================================================
// CURRENCY
// =========================================================

const formatCurrency = (amount, currency = 'INR') => {
  const num = Number(amount) || 0;

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

// =========================================================
// LINE TOTAL
// =========================================================

const getLineTotal = (item) => {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.price) || 0;
  const lineTotal = Number(item.lineTotal);

  if (Number.isFinite(lineTotal)) {
    return lineTotal;
  }

  return price * qty;
};

// =========================================================
// SUBTOTAL
// =========================================================

const computeSubtotal = (items) => {
  return items.reduce((sum, item) => sum + getLineTotal(item), 0);
};

// =========================================================
// FETCH IMAGE
// =========================================================

const fetchImageBuffer = (url, timeout = 5000) => {
  return new Promise((resolve) => {
    if (
      !url ||
      typeof url !== 'string' ||
      !/^https?:\/\//i.test(url)
    ) {
      return resolve(null);
    }

    const lib = url.startsWith('https') ? https : http;

    const req = lib.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();

        return resolve(
          fetchImageBuffer(res.headers.location, timeout)
        );
      }

      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }

      const data = [];

      res.on('data', (chunk) => {
        data.push(chunk);
      });

      res.on('end', () => {
        resolve(Buffer.concat(data));
      });
    });

    req.on('error', () => {
      resolve(null);
    });

    req.setTimeout(timeout, () => {
      req.destroy();
      resolve(null);
    });
  });
};

// =========================================================
// RESOLVE LOGO URL
// =========================================================

const resolveLogoUrl = (logoUrl) => {
  if (!logoUrl || typeof logoUrl !== 'string') {
    return '';
  }

  const trimmed = logoUrl.trim();

  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const fileId = getGoogleDriveFileId(trimmed);

    if (fileId) {
      return buildPublicDriveImageUrl(fileId);
    }

    return normalizeGoogleDriveUrl(trimmed);
  }

  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  return trimmed;
};

// =========================================================
// RENDER INVOICE
// =========================================================

const renderInvoice = (doc, data) => {
  // -------------------------------------------------------
  // PAGE SETTINGS
  // -------------------------------------------------------

  const pageWidth = 595;
  const pageHeight = 842;

  const leftMargin = 50;
  const rightMargin = 50;

  const contentWidth =
    pageWidth - leftMargin - rightMargin;

  let y = 50;

  // -------------------------------------------------------
  // HEADER
  // -------------------------------------------------------

  const logoX = leftMargin;
  const logoY = y;

  const nameX = data.storeLogo
    ? leftMargin + 75
    : leftMargin;

  // Store name
  doc
    .fontSize(20)
    .font('Helvetica-Bold')
    .text(
      data.storeName,
      nameX,
      y
    );

  // Store contact
  doc
    .fontSize(10)
    .font('Helvetica')
    .text(
      data.storeEmail,
      nameX,
      y + 16
    )
    .text(
      data.storePhone,
      nameX,
      y + 30
    );

  // -------------------------------------------------------
  // INVOICE INFORMATION
  // -------------------------------------------------------

  const invoiceInfoWidth = 155;

  const invoiceInfoX =
    pageWidth -
    rightMargin -
    invoiceInfoWidth;

  doc
    .fontSize(14)
    .font('Helvetica-Bold')
    .text(
      'INVOICE',
      invoiceInfoX,
      y,
      {
        width: invoiceInfoWidth,
        align: 'right',
      }
    );

  doc
    .fontSize(10)
    .font('Helvetica')
    .text(
      `Invoice #: ${data.invoiceNumber}`,
      invoiceInfoX,
      y + 16,
      {
        width: invoiceInfoWidth,
        align: 'right',
      }
    )
    .text(
      `Order #: ${data.orderNumber}`,
      invoiceInfoX,
      y + 30,
      {
        width: invoiceInfoWidth,
        align: 'right',
      }
    )
    .text(
      `Invoice Date: ${new Date(
        data.invoiceDate
      ).toLocaleDateString('en-IN')}`,
      invoiceInfoX,
      y + 44,
      {
        width: invoiceInfoWidth,
        align: 'right',
      }
    )
    .text(
      `Order Date: ${new Date(
        data.orderDate
      ).toLocaleDateString('en-IN')}`,
      invoiceInfoX,
      y + 58,
      {
        width: invoiceInfoWidth,
        align: 'right',
      }
    );

  // -------------------------------------------------------
  // LOGO
  // -------------------------------------------------------

  y = 145;

  if (data.logoBuffer) {
    try {
      doc.image(
        data.logoBuffer,
        logoX,
        logoY,
        {
          width: 60,
          height: 40,
          valign: 'top',
        }
      );

      y = Math.max(
        y,
        logoY + 45
      );
    } catch (error) {
      y = 145;
    }
  }

  // -------------------------------------------------------
  // BILL TO
  // -------------------------------------------------------

  doc
    .fontSize(11)
    .font('Helvetica-Bold')
    .text(
      'Bill To:',
      leftMargin,
      y
    );

  doc
    .fontSize(10)
    .font('Helvetica')
    .text(
      data.customerName,
      leftMargin,
      y + 14
    )
    .text(
      data.billingAddress,
      leftMargin,
      y + 26,
      {
        width: 280,
      }
    );

  let shipY = y + 44;

  // Phone
  doc
    .fontSize(10)
    .font('Helvetica')
    .text(
      `Phone: ${data.phone}`,
      leftMargin,
      shipY
    );

  // Email
  doc.text(
    `Email: ${data.customerEmail || 'N/A'}`,
    leftMargin,
    shipY + 14
  );

  y = shipY + 34;

  // -------------------------------------------------------
  // SHIP TO
  // -------------------------------------------------------

  if (
    data.shippingAddress &&
    data.shippingAddress !== data.billingAddress
  ) {
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .text(
        'Ship To:',
        leftMargin,
        y
      );

    doc
      .fontSize(10)
      .font('Helvetica')
      .text(
        data.customerName,
        leftMargin,
        y + 14
      )
      .text(
        data.shippingAddress,
        leftMargin,
        y + 26,
        {
          width: 280,
        }
      );

    y += 44;

    doc
      .fontSize(10)
      .font('Helvetica')
      .text(
        `Phone: ${data.phone}`,
        leftMargin,
        y
      )
      .text(
        `Email: ${data.customerEmail || 'N/A'}`,
        leftMargin,
        y + 14
      );

    y += 34;
  }

  y += 15;

  // -------------------------------------------------------
  // PRODUCT TABLE
  // -------------------------------------------------------

  const tableTop = y;

  const headers = [
    'Product',
    'SKU',
    'Qty',
    'Unit Price',
    'Discount',
    'GST',
    'Total',
  ];

  /*
   * Column widths:
   *
   * Product   140
   * SKU        48
   * Qty        28
   * Unit       70
   * Discount   52
   * GST        48
   * Total      55
   *
   * Column total = 441
   * 6 gaps × 5 = 30
   * Overall = 471
   *
   * Content width = 495
   *
   * Therefore everything fits safely.
   */

  const colWidths = [
    140,
    48,
    28,
    70,
    52,
    48,
    55,
  ];

  const colGap = 5;

  // -------------------------------------------------------
  // TABLE HEADER
  // -------------------------------------------------------

  doc
    .fontSize(9)
    .font('Helvetica-Bold');

  let x = leftMargin;

  headers.forEach((header, index) => {
    doc.text(
      header,
      x,
      tableTop,
      {
        width: colWidths[index],
        align:
          index === 0
            ? 'left'
            : 'right',
      }
    );

    x +=
      colWidths[index] +
      colGap;
  });

  y = tableTop + 17;

  // -------------------------------------------------------
  // TABLE ROWS
  // -------------------------------------------------------

  doc
    .fontSize(8)
    .font('Helvetica');

  data.items.forEach((item) => {
    const row = [
      item.name || 'Product',

      item.sku || '-',

      String(
        item.quantity || 0
      ),

      formatCurrency(
        item.unitPrice,
        data.currency
      ),

      `${Number(
        item.discountPercent || 0
      )}%`,

      `${Number(
        item.gstPercent || 0
      )}%`,

      formatCurrency(
        getLineTotal(item),
        data.currency
      ),
    ];

    // -----------------------------------------------------
    // PRODUCT NAME WRAPPING CALCULATION
    // -----------------------------------------------------

    const productName =
      String(row[0] || '');

    const productNameWidth =
      colWidths[0];

    const charPerLine =
      Math.max(
        1,
        Math.floor(
          productNameWidth / 6.5
        )
      );

    const maxRows =
      Math.max(
        1,
        Math.ceil(
          productName.length /
            charPerLine
        )
      );

    // -----------------------------------------------------
    // DRAW CELLS
    // -----------------------------------------------------

    let cellX = leftMargin;

    row.forEach((cell, index) => {
      doc.text(
        String(cell),
        cellX,
        y,
        {
          width:
            colWidths[index],
          align:
            index === 0
              ? 'left'
              : 'right',
          lineBreak: false,
        }
      );

      cellX +=
        colWidths[index] +
        colGap;
    });

    y += Math.max(
      16,
      16 * maxRows
    );
  });

  // -------------------------------------------------------
  // TABLE DIVIDER
  // -------------------------------------------------------

  y += 8;

  doc
    .moveTo(
      leftMargin,
      y
    )
    .lineTo(
      leftMargin +
        contentWidth,
      y
    )
    .stroke();

  y += 15;

  // =======================================================
  // TOTALS SECTION
  // =======================================================

  /*
   * IMPORTANT:
   *
   * The old code calculated:
   *
   * rightEdge = pageWidth - rightColX
   *
   * which resulted in only 155 points of width.
   *
   * That caused the totals to overlap.
   *
   * We now use a fixed 220-point totals area with
   * separate label and value columns.
   */

  const totalsWidth = 220;

  const totalsX =
    pageWidth -
    rightMargin -
    totalsWidth;

  const labelWidth = 130;
  const valueWidth = 90;

  const labelX = totalsX;
  const valueX =
    totalsX + labelWidth;

  doc
    .fontSize(10)
    .font('Helvetica');

  // -------------------------------------------------------
  // SUMMARY LINE
  // -------------------------------------------------------

  const addSummaryLine = (
    label,
    value
  ) => {
    // Label column
    doc.text(
      label,
      labelX,
      y,
      {
        width: labelWidth,
        align: 'right',
      }
    );

    // Amount column
    doc.text(
      formatCurrency(
        value,
        data.currency
      ),
      valueX,
      y,
      {
        width: valueWidth,
        align: 'right',
      }
    );

    y += 18;
  };

  // Subtotal
  addSummaryLine(
    'Subtotal:',
    data.subtotal
  );

  // Discount
  if (
    Number(
      data.totalDiscount
    ) !== 0
  ) {
    addSummaryLine(
      'Discount:',
      -Number(
        data.totalDiscount
      )
    );
  }

  // GST
  addSummaryLine(
    'GST:',
    data.totalGst
  );

  // Shipping
  addSummaryLine(
    'Shipping:',
    data.shippingCharges
  );

  // -------------------------------------------------------
  // GRAND TOTAL DIVIDER
  // -------------------------------------------------------

  y += 4;

  doc
    .moveTo(
      totalsX,
      y
    )
    .lineTo(
      totalsX +
        totalsWidth,
      y
    )
    .stroke();

  y += 12;

  // -------------------------------------------------------
  // GRAND TOTAL
  // -------------------------------------------------------

  doc
    .fontSize(12)
    .font('Helvetica-Bold');

  doc.text(
    'Grand Total:',
    labelX,
    y,
    {
      width: labelWidth,
      align: 'right',
    }
  );

  doc.text(
    formatCurrency(
      data.grandTotal,
      data.currency
    ),
    valueX,
    y,
    {
      width: valueWidth,
      align: 'right',
    }
  );

  // =======================================================
  // PAYMENT / STATUS
  // =======================================================

  y += 28;

  doc
    .fontSize(9)
    .font('Helvetica');

  const paymentText =
    `Payment Method: ${String(
      data.paymentMethod || 'cod'
    ).toUpperCase()}`;

  const paymentStatusText =
    `Payment Status: ${
      data.paymentStatus ||
      'pending'
    }`;

  const orderStatusText =
    `Order Status: ${
      data.orderStatus ||
      'new'
    }`;

  doc.text(
    paymentText,
    leftMargin,
    y,
    {
      width: 150,
      align: 'left',
    }
  );

  doc.text(
    paymentStatusText,
    leftMargin + 165,
    y,
    {
      width: 150,
      align: 'left',
    }
  );

  doc.text(
    orderStatusText,
    leftMargin + 330,
    y,
    {
      width: 115,
      align: 'left',
    }
  );

  // -------------------------------------------------------
  // TRACKING NUMBER
  // -------------------------------------------------------

  if (data.trackingNumber) {
    y += 18;

    doc.text(
      `Tracking No: ${data.trackingNumber}`,
      leftMargin,
      y,
      {
        width: contentWidth,
        align: 'left',
      }
    );
  }

  // =======================================================
  // FOOTER
  // =======================================================

  y += 28;

  doc
    .fontSize(8)
    .font('Helvetica')
    .text(
      'Thank you for your order!',
      0,
      y,
      {
        width: pageWidth,
        align: 'center',
      }
    )
    .text(
      'This is a computer-generated invoice.',
      0,
      y + 14,
      {
        width: pageWidth,
        align: 'center',
      }
    );

  // Finish PDF
  doc.end();
};

// =========================================================
// BUILD INVOICE DATA
// =========================================================

const buildInvoiceData = async (order) => {
  const [
    storeSettings,
    homepageSettings,
  ] = await Promise.all([
    StoreSetting.getSettings(),
    HomepageSetting.getSettings(),
  ]);

  const plainOrder =
    typeof order?.toObject === 'function'
      ? order.toObject()
      : { ...order };

  const currency =
    storeSettings.currency ||
    'INR';

  const logoUrl =
    resolveLogoUrl(
      homepageSettings.footerLogoUrl
    );

  let logoBuffer = null;

  if (
    logoUrl &&
    /^https?:\/\//i.test(logoUrl)
  ) {
    logoBuffer =
      await fetchImageBuffer(
        logoUrl
      );
  }

  // -------------------------------------------------------
  // ITEMS
  // -------------------------------------------------------

  const items = (
    plainOrder.items || []
  ).map((item) => {
    const qty =
      Number(item.quantity) || 0;

    const price =
      Number(item.price) || 0;

    const discountPercent =
      Number(item.discount) || 0;

    const gstPercent =
      Number(item.gst) || 0;

    const gross =
      price * qty;

    const discountAmount =
      gross *
      (discountPercent / 100);

    const taxableValue =
      Math.max(
        0,
        gross -
          discountAmount
      );

    const gstAmount =
      taxableValue *
      (gstPercent / 100);

    const lineTotal =
      Number.isFinite(
        Number(item.lineTotal)
      )
        ? Number(item.lineTotal)
        : taxableValue +
          gstAmount;

    const product =
      typeof item.product ===
        'object' &&
      item.product
        ? item.product
        : {};

    return {
      name:
        item.name ||
        product.name ||
        'Product',

      sku:
        item.sku ||
        product.sku ||
        '',

      image:
        item.image ||
        product.primaryImage ||
        '',

      quantity: qty,

      unitPrice: price,

      discountPercent,

      discountAmount,

      taxableValue,

      gstPercent,

      gstAmount,

      lineTotal,
    };
  });

  // -------------------------------------------------------
  // TOTALS
  // -------------------------------------------------------

  const subtotal =
    items.reduce(
      (sum, item) =>
        sum + item.gross,
      0
    );

  const totalDiscount =
    items.reduce(
      (sum, item) =>
        sum +
        item.discountAmount,
      0
    );

  const totalGst =
    items.reduce(
      (sum, item) =>
        sum + item.gstAmount,
      0
    );

  const shippingCharges =
    Number(
      plainOrder.shippingPrice
    ) || 0;

  const grandTotal =
    Number(
      plainOrder.totalPrice
    ) || 0;

  // -------------------------------------------------------
  // CUSTOMER
  // -------------------------------------------------------

  const billing =
    plainOrder.billingAddress ||
    plainOrder.shippingAddress ||
    {};

  const shipping =
    plainOrder.shippingAddress ||
    {};

  const customer =
    typeof plainOrder.user ===
      'object' &&
    plainOrder.user
      ? plainOrder.user
      : {};

  // -------------------------------------------------------
  // RETURN DATA
  // -------------------------------------------------------

  return {
    // Store
    storeName:
      storeSettings.storeName ||
      'Jewellery Shop',

    storeEmail:
      storeSettings.email ||
      '',

    storePhone:
      storeSettings.phone ||
      '',

    storeLogo:
      logoUrl || '',

    logoBuffer,

    currency,

    // Invoice
    invoiceNumber:
      plainOrder.invoiceNumber ||
      '',

    orderNumber:
      plainOrder.orderNumber ||
      '',

    invoiceDate:
      plainOrder.updatedAt ||
      plainOrder.createdAt ||
      new Date(),

    orderDate:
      plainOrder.createdAt ||
      new Date(),

    // Customer
    customerName:
      billing.fullName ||
      customer.name ||
      '',

    customerEmail:
      customer.email ||
      '',

    billingAddress:
      `${billing.address || ''}${
        billing.landmark
          ? ', ' +
            billing.landmark
          : ''
      }, ${
        billing.city || ''
      }, ${
        billing.state || ''
      } ${
        billing.pincode || ''
      }`
        .trim()
        .replace(
          /^,\s*/,
          ''
        ),

    shippingAddress:
      `${shipping.address || ''}${
        shipping.landmark
          ? ', ' +
            shipping.landmark
          : ''
      }, ${
        shipping.city || ''
      }, ${
        shipping.state || ''
      } ${
        shipping.pincode || ''
      }`
        .trim()
        .replace(
          /^,\s*/,
          ''
        ),

    phone:
      shipping.phone ||
      billing.phone ||
      '',

    // Items
    items,

    // Totals
    subtotal,

    totalDiscount,

    totalGst,

    shippingCharges,

    grandTotal,

    // Status
    paymentMethod:
      plainOrder.paymentMethod ||
      'cod',

    paymentStatus:
      plainOrder.paymentStatus ||
      'pending',

    orderStatus:
      plainOrder.status ||
      'new',

    trackingNumber:
      plainOrder.trackingNumber ||
      '',
  };
};

// =========================================================
// GENERATE INVOICE PDF
// =========================================================

const generateInvoicePDF = async (
  order
) => {
  const data =
    await buildInvoiceData(
      order
    );

  return new Promise(
    (resolve, reject) => {
      const doc =
        new PDFDocument({
          margin: 50,
          size: 'A4',
        });

      const chunks = [];

      doc.on(
        'data',
        (chunk) => {
          chunks.push(chunk);
        }
      );

      doc.on(
        'end',
        () => {
          resolve(
            Buffer.concat(chunks)
          );
        }
      );

      doc.on(
        'error',
        reject
      );

      renderInvoice(
        doc,
        data
      );
    }
  );
};

// =========================================================
// STREAM INVOICE TO RESPONSE
// =========================================================

const streamInvoiceToResponse =
  async (
    order,
    res
  ) => {
    const data =
      await buildInvoiceData(
        order
      );

    res.setHeader(
      'Content-Type',
      'application/pdf'
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice-${
        data.invoiceNumber ||
        data.orderNumber ||
        'order'
      }.pdf"`
    );

    res.setHeader(
      'Content-Transfer-Encoding',
      'binary'
    );

    const doc =
      new PDFDocument({
        margin: 50,
        size: 'A4',
      });

    doc.on(
      'data',
      (chunk) => {
        if (!res.write(chunk)) {
          doc.pause();

          res.once(
            'drain',
            () => {
              doc.resume();
            }
          );
        }
      }
    );

    doc.on(
      'end',
      () => {
        res.end();
      }
    );

    doc.on(
      'error',
      (err) => {
        console.error(
          'Invoice PDF generation error:',
          err
        );

        if (
          !res.headersSent
        ) {
          res
            .status(500)
            .json({
              success: false,
              message:
                'Failed to generate invoice',
            });
        } else {
          res.end();
        }
      }
    );

    renderInvoice(
      doc,
      data
    );
  };

// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  generateInvoicePDF,
  streamInvoiceToResponse,
  buildInvoiceData,
  resolveLogoUrl,
  fetchImageBuffer,
  formatCurrency,
  getLineTotal,
};