# Stagehand MongoDB Scraper (Python)

A Python web scraping project that uses Stagehand to extract structured data from e-commerce websites and store it in MongoDB for analysis.

## Features

- **🌐 Web Scraping**: Uses Stagehand (built on Playwright) for intelligent web scraping
- **🧠 AI-Powered Extraction**: Extracts structured product data using AI-powered instructions
- **🗄️ MongoDB Storage**: Stores scraped data in MongoDB for persistence and querying
- **✅ Schema Validation**: Uses Pydantic for schema validation and type safety
- **🛡️ Error Handling**: Robust error handling to prevent crashes during scraping
- **📊 Data Analysis**: Built-in MongoDB queries for data analysis with beautiful tables
- **🎨 Rich Output**: Colorful console output with progress indicators

## Prerequisites

- Python 3.8 or higher
- MongoDB installed locally or MongoDB Atlas account
- Stagehand API key

## Installation

1. Navigate to the Python directory:

   ```bash
   cd examples/integrations/mongodb/python
   ```

2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Set up environment variables:

   ```bash
   # Copy the example environment file
   cp env.example .env

   # Edit .env with your actual values
   # MONGO_URI=mongodb://localhost:27017
   # DB_NAME=scraper_db
   # STAGEHAND_API_KEY=your_stagehand_api_key_here
   ```

## Usage

1. Start MongoDB locally:

   ```bash
   mongod
   ```

2. Run the scraper:

   ```bash
   python main.py
   ```

3. The script will:
   - 🔌 Connect to MongoDB and create necessary indexes
   - 📊 Scrape product listings from Amazon laptops category
   - 🔍 Extract detailed information for the first 3 products
   - 💾 Store all data in MongoDB with proper schemas
   - 📈 Run analysis queries showing:
     - Collection document counts
     - Products grouped by category
     - Top-rated products (4+ stars)

## Project Structure

```
python/
├── main.py              # Main application with all functionality
├── requirements.txt     # Python dependencies
├── env.example         # Example environment variables
└── README.md           # This file
```

## Data Models

The project uses Pydantic models for data validation:

### Product Model

```python
class Product(BaseModel):
    url: str
    date_scraped: datetime
    name: str
    price: str
    rating: Optional[float] = None
    category: Optional[str] = None
    id: Optional[str] = None
    currency: Optional[str] = None
    image_url: Optional[str] = None
    review_count: Optional[int] = None
    description: Optional[str] = None
    specs: Optional[Dict[str, Any]] = None
```

### ProductList Model

```python
class ProductList(BaseModel):
    products: List[Product]
    category: Optional[str] = None
    date_scraped: datetime
    total_products: Optional[int] = None
    page: Optional[int] = None
    website_name: Optional[str] = None
```

## MongoDB Collections

Data is stored in the following MongoDB collections:

- **`products`**: Individual product information with indexes on:
  - `rating` (ascending)
  - `category` (ascending)
  - `url` (ascending, unique)
  - `date_scraped` (descending)

- **`product_lists`**: Lists of products from category pages with indexes on:
  - `category` (ascending)
  - `date_scraped` (descending)

## Configuration

The application supports both local and Browserbase environments:

```python
# Local browser (default)
config = StagehandConfig(
    api_key=os.getenv('STAGEHAND_API_KEY'),
    env="LOCAL",
    verbose=1
)

# Browserbase (cloud browsers)
config = StagehandConfig(
    api_key=os.getenv('STAGEHAND_API_KEY'),
    env="BROWSERBASE",
    verbose=1
)
```

## Key Classes

### MongoDBManager

Handles all MongoDB operations including:

- Connection management
- Index creation
- Data storage and retrieval
- Aggregation queries

### ProductScraper

Handles web scraping using Stagehand:

- Product list scraping from category pages
- Detailed product information extraction
- Rate limiting and error handling

### DataAnalyzer

Provides data analysis and reporting:

- Collection statistics
- Category-based analysis
- Top-rated product reports

## Error Handling

The application includes comprehensive error handling:

- MongoDB connection errors
- Web scraping failures
- Data validation errors
- Graceful cleanup on exit

## Example Output

```
🤘 Welcome to Stagehand MongoDB Scraper!

🔌 Connecting to MongoDB...
✅ Connected to MongoDB
⚙️ Creating indexes...
✅ Created index rating_idx on products
✅ Index creation completed

📊 Starting to scrape product listing from: https://www.amazon.com/s?k=laptops
✅ Scraped 16 products from category: Laptops

📊 Running Data Analysis
┏━━━━━━━━━━━━━━━┳━━━━━━━┓
┃ Collection    ┃ Count ┃
┡━━━━━━━━━━━━━━━╇━━━━━━━┩
│ PRODUCTS      │ 19    │
│ PRODUCT_LISTS │ 1     │
└───────────────┴───────┘

🎉 Scraping and MongoDB operations completed successfully!
```

## Troubleshooting

### MongoDB Connection Issues

- Ensure MongoDB is running: `mongod`
- Check connection string in `.env` file
- Verify database permissions

### Stagehand API Issues

- Verify API key in `.env` file
- Check Stagehand service status
- Review rate limiting settings

### Dependencies Issues

```bash
# Reinstall dependencies
pip install --upgrade -r requirements.txt

# For Playwright browser issues
playwright install
```

## License

MIT

## Acknowledgements

- [Stagehand](https://docs.stagehand.dev/) - Powerful web scraping with AI
- [MongoDB](https://www.mongodb.com/) - Flexible document database
- [Pydantic](https://pydantic.dev/) - Data validation using Python type hints
- [Rich](https://rich.readthedocs.io/) - Beautiful terminal output
