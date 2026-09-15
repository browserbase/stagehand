# Browserbase + Stagehand MongoDB Integration

Location in the Stagehand repository: `packages/examples/mongodb`.

A comprehensive web scraping integration that uses Stagehand to extract structured data from e-commerce websites and store it in MongoDB for analysis. Available in both **Python** and **TypeScript**.

## 🚀 Choose Your Language

<table>
<tr>
<td width="50%" valign="top">

### 🐍 **Python Version**

**`📁 python/`**

Perfect for data scientists and Python developers who want:

- **Rich terminal output** with beautiful tables and progress indicators
- **Pydantic models** for robust data validation
- **Async/await** support for high-performance scraping
- **pymongo** for MongoDB operations
- Simple single-file architecture

**[→ Get Started with Python](python/README.md)**

```bash
cd python/
pip install -r requirements.txt
python main.py
```

</td>
<td width="50%" valign="top">

### 📘 **TypeScript Version**

**`📁 typescript/`**

Ideal for JavaScript/Node.js developers who prefer:

- **Type safety** with full TypeScript support
- **Zod schemas** for runtime validation
- **Modern ES modules** and clean architecture
- **MongoDB native driver** with full typing
- Modular, well-structured codebase

**[→ Get Started with TypeScript](typescript/README.md)**

```bash
cd typescript/
npm install
npm start
```

</td>
</tr>
</table>

## 🌟 Features (Both Versions)

- **🌐 Intelligent Web Scraping**: Uses Stagehand's AI-powered extraction
- **🗄️ MongoDB Storage**: Persistent data storage with proper indexing
- **📊 Data Analysis**: Built-in queries and reporting
- **🛡️ Error Handling**: Robust error handling and recovery
- **⚡ Performance**: Optimized for speed and reliability
- **🔍 Schema Validation**: Type-safe data models

## 📋 What It Does

Both versions perform the same core functionality:

1. **🔌 Connect** to MongoDB and set up collections with proper indexes
2. **📊 Scrape** Amazon product listings using Stagehand's AI extraction
3. **🔍 Extract** detailed product information including:
   - Product names, prices, ratings
   - Categories, descriptions, specifications
   - Review counts and availability
4. **💾 Store** all data in MongoDB with validated schemas
5. **📈 Analyze** the data with built-in reporting:
   - Collection statistics
   - Products by category
   - Top-rated products

## 🛠️ Prerequisites

**For Both Versions:**

- MongoDB installed locally or MongoDB Atlas account
- Stagehand API key

**Python Version:**

- Python 3.8+

**TypeScript Version:**

- Node.js 16+
- npm or pnpm

## 🚦 Quick Start

### Python Quick Start

```bash
# Navigate to Python version
cd packages/examples/mongodb/python

# Install dependencies
pip install -r requirements.txt

# Set up environment
cp env.example .env
# Edit .env with your MongoDB URI and Stagehand API key

# Run the scraper
python main.py
```

### TypeScript Quick Start

```bash
# Navigate to TypeScript version
cd packages/examples/mongodb/typescript

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your MongoDB URI and Stagehand API key

# Run the scraper
npm start
```

## 📊 Sample Output

Both versions provide rich, colorful output showing the scraping progress:

```
🤘 Welcome to Stagehand MongoDB Scraper!

🔌 Connecting to MongoDB...
✅ Connected to MongoDB
⚙️ Creating indexes...
✅ Index creation completed

📊 Starting to scrape product listing...
✅ Scraped 16 products from category: Laptops

📊 Scraping details for product 1/3: MacBook Pro M3
✅ Scraped detailed information for: MacBook Pro M3

📊 Running Data Analysis
┌─────────────────┬───────┐
│ Collection      │ Count │
├─────────────────┼───────┤
│ PRODUCTS        │ 19    │
│ PRODUCT_LISTS   │ 1     │
└─────────────────┴───────┘

🎉 Scraping completed successfully!
```

## 🏗️ Architecture

Both versions follow the same architectural patterns:

- **MongoDB Manager**: Handles database connections, indexing, and operations
- **Product Scraper**: Manages web scraping using Stagehand
- **Data Models**: Structured schemas for products and product lists
- **Data Analyzer**: Provides insights and reporting on collected data

## 🔧 Configuration

Both versions support:

- **Browserbase** cloud browsers for scalability
- **Environment-based** configuration
- **Flexible MongoDB** connection options

## 📚 Documentation

- **[Python Version Documentation](python/README.md)** - Detailed Python setup and usage
- **[TypeScript Version Documentation](typescript/README.md)** - Complete TypeScript guide
- **[Stagehand Documentation](https://docs.stagehand.dev/)** - Learn more about Stagehand
- **[MongoDB Documentation](https://docs.mongodb.com/)** - MongoDB setup and operations

## 🤝 Contributing

Both versions are actively maintained and welcome contributions:

- Bug reports and feature requests
- Code improvements and optimizations
- Documentation enhancements
- Additional data analysis features

## 📄 License

MIT License - feel free to use in your projects!

## 🙏 Acknowledgements

- **[Stagehand](https://docs.stagehand.dev/)** - AI-powered web scraping
- **[MongoDB](https://www.mongodb.com/)** - Flexible document database
- **[Pydantic](https://pydantic.dev/)** (Python) - Data validation
- **[Zod](https://zod.dev/)** (TypeScript) - Schema validation

---

## 🤘 Ready to Start?

Choose your preferred language and dive in:

**🐍 [Python Version →](python/README.md)** | **📘 [TypeScript Version →](typescript/README.md)**
