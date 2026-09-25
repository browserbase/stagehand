# Stagehand MongoDB Scraper

Location in the Stagehand repository: `packages/examples/mongodb/typescript`.

A web scraping project that uses Stagehand to extract structured data from e-commerce websites and store it in MongoDB for analysis.

## Features

- **Web Scraping**: Uses Stagehand (built on Playwright) for intelligent web scraping
- **Data Extraction**: Extracts structured product data using AI-powered instructions
- **MongoDB Storage**: Stores scraped data in MongoDB for persistence and querying
- **Schema Validation**: Uses Zod for schema validation and TypeScript interfaces
- **Error Handling**: Robust error handling to prevent crashes during scraping
- **Data Analysis**: Built-in MongoDB queries for data analysis

## Prerequisites

- Node.js 22.18 or higher
- MongoDB installed locally or MongoDB Atlas account
- Browserbase API key

## Installation

1. Clone the repository:

   ```
   cd packages/examples/mongodb/typescript
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Set up environment variables:
   ```
   # Create a .env file with the following variables
   BROWSERBASE_API_KEY=your_browserbase_api_key
   MONGO_URI=mongodb://localhost:27017
   DB_NAME=scraper_db
   ```

## Usage

1. Start MongoDB locally:

   ```
   mongod
   ```

2. Run the scraper:

   ```
   npm start
   ```

3. The script will:
   - Scrape product listings from Amazon
   - Extract detailed information for the first 3 products
   - Extract reviews for each product
   - Store all data in MongoDB
   - Run analysis queries on the collected data showing:
     - Collection counts
     - Products by category
     - Top-rated products

## Project Structure

The project has a simple structure with a single file containing all functionality:

- `index.ts`: Contains the complete implementation including:
  - MongoDB connection and data operations
  - Schema definitions
  - Scraping functions
  - Data analysis
  - Main execution logic
- `.env.example`: Example environment variables

## Data Models

The project uses the following data models:

- **Product**: Individual product information
- **ProductList**: List of products from a category page
- **Review**: Product reviews

## MongoDB Collections

Data is stored in the following MongoDB collections:

- **products**: Individual product information
- **product_lists**: Lists of products from category pages
- **reviews**: Product reviews

## License

MIT

## Acknowledgements

- [Stagehand](https://docs.stagehand.dev/) for the powerful web scraping capabilities
- [MongoDB](https://www.mongodb.com/) for the flexible document database
- [Zod](https://zod.dev/) for runtime schema validation
