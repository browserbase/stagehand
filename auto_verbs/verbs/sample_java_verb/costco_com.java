// import com.google.gson.Gson;
// import com.google.gson.GsonBuilder;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.Locator;

public class costco_com extends com_base {
    public costco_com(BrowserContext _context) {
        super(_context);
    }

    /**
     * Search for a list of products at Costco and return the list.
     * @param searchTerm The product to search for (e.g., "eggs", "mower").
     * @return ProductListResult containing a list of found products and any error message.
     */
    public ProductListResult searchProducts(String searchTerm) {
        java.util.List<ProductInfo> products = new java.util.ArrayList<>();
        String error = null;
        try {
            page.navigate("https://www.costco.com/");
            Locator searchBox = page.locator("input[placeholder='Search Costco']");
            if (searchBox.count() == 0) {
                searchBox = page.locator("input[aria-label='Search Costco']");
            }
            searchBox.first().click();
            searchBox.first().fill(searchTerm);
            searchBox.first().press("Enter");
            page.waitForTimeout(3000);
            for (int i = 1; i <= 5; i++) {
                String selector = String.format(".MuiGrid2-root:nth-child(%d) > .MuiBox-root", i);
                Locator productBox = page.locator(selector);
                if (productBox.count() > 0) {
                    String innerText = productBox.first().innerText();
                    String[] lines = innerText.split("\n");
                    String productName = "N/A";
                    CurrencyAmount productPrice = null;
                    for (String line : lines) {
                        if (line.startsWith("$")) {
                            String numericPrice = line.replaceAll("[^0-9.]", "");
                            try {
                                double priceValue = Double.parseDouble(numericPrice);
                                productPrice = new CurrencyAmount(priceValue);
                            } catch (Exception e) {
                                productPrice = null;
                            }
                            break;
                        }
                    }
                    if (productPrice == null) {  //Before logging in, some products may show "Members Only" without a price. Skip these.
                        continue;
                    }
                    if (lines.length > 0) {
                        productName = lines[0];
                    }
                    products.add(new ProductInfo(productName, productPrice));
                }
            }
        } catch (Exception e) {
            error = e.getMessage();
        }
        ProductListResult result = new ProductListResult(products, error);
        System.out.println(result);
        return result;
    }

    /**
     * Search for a product at Costco and return only the first product found.
     * @param searchTerm The product to search for (e.g., "eggs", "mower").
     * @return ProductInfo for the first product found, or with error message if not found.
     */
    public ProductInfo searchProduct(String searchTerm) {
        ProductListResult allProducts = searchProducts(searchTerm);
        if (allProducts.error != null) {
            return new ProductInfo("N/A", null, allProducts.error);
        }
        if (!allProducts.products.isEmpty()) {
            return allProducts.products.get(0);
        }
        return new ProductInfo("N/A", null, "No products found");
    }

    /**
     * Set the preferred warehouse by city or zip code.
     * @param location The city, state, or zip code to set as preferred warehouse.
     * @return WarehouseStatusResult with status or error message.
     */
    public WarehouseStatusResult setPreferredWarehouse(String location) {
        String status = null;
        String error = null;
        try {
            page.navigate("https://www.costco.com/");
            Locator warehouseBtn = page.locator("[data-testid='WarehouseSelectorUI'] [data-testid='Button_locationselector_WarehouseSelector--submit']");
            if (warehouseBtn.count() > 0) {
                warehouseBtn.first().click();
                page.waitForTimeout(1000);
            }
            Locator input = page.locator("input[name='City, State, or Zip']");
            if (input.count() > 0) {
                input.first().click();
                input.first().fill(location);
                page.waitForTimeout(1000);
            }
            Locator suggestion = page.locator("[id$='-option-0']");
            if (suggestion.count() > 0) {
                suggestion.first().click();
                page.waitForTimeout(1000);
            }
            Locator findBtn = page.locator("[data-testid='Button_warehousedrawer-submit']");
            if (findBtn.count() > 0) {
                findBtn.first().click();
                page.waitForTimeout(1000);
            }
            Locator setBtn = page.locator("[data-testid='Button_warehousetile-setwarehouse-as-preferred']");
            if (setBtn.count() > 0) {
                setBtn.first().click();
                page.waitForTimeout(1000);
            }
            status = "success";
        } catch (Exception e) {
            error = e.getMessage();
        }
        WarehouseStatusResult result = new WarehouseStatusResult(status, error);
        System.out.println(result);
        return result;
    }

    /**
     * Represents a product with name and price.
     */
    public static class ProductInfo {
        /** Name of the product. */
        public final String productName;
        /** Price of the product. */
        public final CurrencyAmount productPrice;
        /** Error message, if any. */
        public final String error;
        public ProductInfo(String productName, CurrencyAmount productPrice) {
            this(productName, productPrice, null);
        }
        public ProductInfo(String productName, CurrencyAmount productPrice, String error) {
            this.productName = productName;
            this.productPrice = productPrice;
            this.error = error;
        }
        @Override
        public String toString() {
            if (error != null) {
                return String.format("Product: %s, Error: %s", productName, error);
            }
            return String.format("Product: %s, Price: %s", productName, productPrice != null ? productPrice : "N/A");
        }
    }

    /**
     * Represents a list of products and an optional error message.
     */
    public static class ProductListResult {
        /** List of found products. */
        public final java.util.List<ProductInfo> products;
        /** Error message, if any. */
        public final String error;
        public ProductListResult(java.util.List<ProductInfo> products, String error) {
            this.products = products;
            this.error = error;
        }
        @Override
        public String toString() {
            if (error != null) {
                return String.format("Error: %s", error);
            }
            StringBuilder sb = new StringBuilder();
            sb.append(String.format("Found %d products:\n", products.size()));
            for (int i = 0; i < products.size(); i++) {
                sb.append(String.format("  %d. %s\n", i + 1, products.get(i)));
            }
            return sb.toString();
        }
    }

    /**
     * Represents the result of setting a preferred warehouse.
     */
    public static class WarehouseStatusResult {
        /** Status string, e.g., "success". */
        public final String status;
        /** Error message, if any. */
        public final String error;
        public WarehouseStatusResult(String status, String error) {
            this.status = status;
            this.error = error;
        }
        @Override
        public String toString() {
            if (error != null) {
                return String.format("Error: %s", error);
            }
            return String.format("Status: %s", status);
        }
    }
}
