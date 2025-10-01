import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 4001;

const collectionUrls = [
  "https://tunisiamarka.com.tn/brands-18-Anua.html",
  "https://tunisiamarka.com.tn/brands-6-Cosrx-1.html",
  "https://tunisiamarka.com.tn/brands-6-Cosrx-2.html",
  "https://tunisiamarka.com.tn/brands-16-SKINBrand-1.html",
  "https://tunisiamarka.com.tn/brands-16-SKINBrand-2.html",
  "https://tunisiamarka.com.tn/brands-16-SKINBrand-3.html",
  "https://tunisiamarka.com.tn/brands-3-SomeByMi.html",
  "https://tunisiamarka.com.tn/brands-3-SomeByMi-2.html",
  "https://tunisiamarka.com.tn/brands-17-BeautyofJoseon-.html",
  "https://tunisiamarka.com.tn/brands-17-BeautyofJoseon-2.html",
  "https://tunisiamarka.com.tn/brands-20-AXIS-Y.html",
  "https://tunisiamarka.com.tn/brands-21-DrAlthea.html",
  "https://tunisiamarka.com.tn/brands-19-MEDICUBE.html",
  "https://tunisiamarka.com.tn/brands-19-MEDICUBE-2.html",
  "https://tunisiamarka.com.tn/brands-19-MEDICUBE-3.html",
  "https://tunisiamarka.com.tn/brands-19-MEDICUBE-4.html",
  "https://tunisiamarka.com.tn/brands-19-MEDICUBE-5.html",
  "https://tunisiamarka.com.tn/brands-19-MEDICUBE-6.html"
];

// --- Utilitaire pour extraire la marque depuis l'URL ---
function extractBrandName(url) {
  const match = url.match(/brands-\d+-(.+?)\.html/i);
  if (match) {
    return match[1].replace(/-/g, " ");
  }
  return "Unknown";
}

// Fonction pour extraire les liens produits d'une page collection
async function getProductLinks(url) {
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);
  const brand = $(".section-title h2").text().trim() || extractBrandName(url);

  const products = [];

  $(".grid-items").each((_, el) => {
    const link = $(el).find(".caption h3 a").attr("href");
    const name = $(el).find(".caption h3 a").text().trim();
    const newPrice = $(el).find(".pro-price .new-price").text().trim();

    if (link) {
      products.push({
        brand,
        name,
        url: link,
        price: newPrice,
      });
    }
  });

  return products;
}

// Fonction pour checker si un produit est en stock
async function checkStock(product) {
  try {
    const { data } = await axios.get(product.url);
    const $ = cheerio.load(data);

    const availability = $(".pro-available .pro-instock").text().trim();
    let status = "In Stock";
    if (availability.includes("Out of stock")) {
      status = "Out of Stock";
    }

    return { ...product, status };
  } catch (err) {
    console.error(`Erreur sur ${product.url}:`, err.message);
    return { ...product, status: "Error" };
  }
}

// Route API
app.get("/stock", async (req, res) => {
  try {
    let allProducts = [];

    for (const url of collectionUrls) {
      console.log(`🔎 Scraping ${url}...`);
      const products = await getProductLinks(url);

      // Vérifie stock pour chaque produit
      const results = await Promise.all(products.map(checkStock));
      allProducts.push(...results);
    }

    // Tri par marque puis nom
    allProducts.sort((a, b) => {
      if (a.brand === b.brand) return a.name.localeCompare(b.name);
      return a.brand.localeCompare(b.brand);
    });

    res.json(allProducts);
  } catch (error) {
    console.error("Erreur API:", error.message);
    res.status(500).json({ error: "Erreur lors du scraping" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
});
